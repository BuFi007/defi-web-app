//! Rust replacement for `apps/keeper-gateway-signer`.
//!
//! The loop reads pending `TelaranaGatewayMintContextPrepared` rows from the
//! Envio-backed API, checks the destination `TelaranaGatewayHubHook` state,
//! signs a Circle Gateway `BurnIntent`, asks Circle for the attestation, and
//! submits `receiveGatewayMint(...)` on the destination hub.

use std::collections::BTreeMap;
use std::str::FromStr;
use std::time::Duration;

use alloy_network::EthereumWallet;
use alloy_primitives::{hex, Address, Bytes, B256, Signature as PrimitiveSignature, U256};
use alloy_provider::{Provider, ProviderBuilder};
use alloy_signer::SignerSync;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::{eip712_domain, sol, SolStruct};
use serde::Deserialize;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::config::Config;

const ARC_CHAIN_ID: u64 = 5_042_002;
const FUJI_CHAIN_ID: u64 = 43_113;
const ARC_DOMAIN: u32 = 26;
const FUJI_DOMAIN: u32 = 1;
const DEFAULT_ARC_RPC_URL: &str = "https://rpc.testnet.arc.network";
const DEFAULT_FUJI_RPC_URL: &str = "https://api.avax-test.network/ext/bc/C/rpc";
const DEFAULT_GATEWAY_API_BASE: &str = "https://gateway-api-testnet.circle.com/v1";
const DEFAULT_MAX_FEE: u64 = 2_010_000;
const MAX_BLOCK_WINDOW: u64 = 7_200;

const CONTEXTS_QUERY: &str = r#"
query GatewaySignerContexts($limit: Int!) {
  TelaranaGatewayContext(limit: $limit) {
    id
    chainId
    routeId
    telaranaGatewayHook
    gatewayAction
    sourceDepositor
    sourceSigner
    recipient
    tokenOut
    amount
    minAmountOut
    spotRouteId
    metadataRef
  }
  TelaranaMarket {
    id
    routeId
    sourceDomain
    destinationDomain
    sourceUsdc
    destinationUsdc
    sourceGatewayWallet
    destinationGatewayMinter
    signerMode
    enabled
    metadataRef
  }
}
"#;

sol! {
    #[derive(Debug, serde::Serialize)]
    struct TransferSpec {
        uint32 version;
        uint32 sourceDomain;
        uint32 destinationDomain;
        bytes32 sourceContract;
        bytes32 destinationContract;
        bytes32 sourceToken;
        bytes32 destinationToken;
        bytes32 sourceDepositor;
        bytes32 destinationRecipient;
        bytes32 sourceSigner;
        bytes32 destinationCaller;
        uint256 value;
        bytes32 salt;
        bytes hookData;
    }

    #[derive(Debug, serde::Serialize)]
    struct BurnIntent {
        uint256 maxBlockHeight;
        uint256 maxFee;
        TransferSpec spec;
    }

    #[sol(rpc)]
    contract TelaranaGatewayHubHookContract {
        struct GatewayMintContext {
            bytes32 routeId;
            bytes32 requestId;
            uint8 action;
            address sourceDepositor;
            address sourceSigner;
            address recipient;
            address tokenOut;
            uint256 amount;
            uint256 minAmountOut;
            bytes32 spotRouteId;
            bytes32 metadataRef;
            bytes hookData;
        }

        function gatewayRequestState(bytes32 requestId) external view returns (uint8 state);
        function receiveGatewayMint(
            bytes attestationPayload,
            bytes signature,
            GatewayMintContext context
        ) external returns (uint256 amountReceived);
    }
}

#[derive(Debug, Error)]
pub enum GatewaySignerBootError {
    #[error("invalid BUFI_API_URL/TELARANA_API_URL: {0}")]
    InvalidApiUrl(String),
    #[error("invalid GATEWAY_API_BASE: {0}")]
    InvalidCircleApiUrl(String),
    #[error("invalid keeper signer key: {0}")]
    InvalidSignerKey(String),
}

#[derive(Debug, Error)]
enum GatewaySignerError {
    #[error("api http: {0}")]
    ApiHttp(String),
    #[error("api graphql: {0}")]
    ApiGraphql(String),
    #[error("api parse: {0}")]
    ApiParse(String),
    #[error("Circle Gateway: {0}")]
    Circle(String),
    #[error("invalid RPC URL for chain {chain_id}: {reason}")]
    InvalidRpcUrl { chain_id: u64, reason: String },
    #[error("unsupported Gateway domain {0}")]
    UnsupportedDomain(u32),
    #[error("on-chain: {0}")]
    Onchain(String),
    #[error("signing: {0}")]
    Signing(String),
}

pub struct GatewaySigner {
    api_url: String,
    circle_api: String,
    interval: Duration,
    dry_run: bool,
    candidate_limit: usize,
    signer: PrivateKeySigner,
    signer_key_hex: String,
    http: reqwest::Client,
}

impl GatewaySigner {
    pub fn new(cfg: &Config, signer_key_hex: &str) -> Result<Option<Self>, GatewaySignerBootError> {
        if !cfg.gateway_signer_enabled {
            return Ok(None);
        }

        let api_url =
            normalize_url(&cfg.telarana_api_url).map_err(GatewaySignerBootError::InvalidApiUrl)?;
        let circle_api = normalize_url(
            &std::env::var("GATEWAY_API_BASE")
                .unwrap_or_else(|_| DEFAULT_GATEWAY_API_BASE.to_string()),
        )
        .map_err(GatewaySignerBootError::InvalidCircleApiUrl)?;
        let signer: PrivateKeySigner =
            signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    GatewaySignerBootError::InvalidSignerKey(e.to_string())
                })?;
        let interval = Duration::from_millis(env_u64("GATEWAY_SIGNER_INTERVAL_MS", 10_000));
        let dry_run = env_bool("GATEWAY_SIGNER_DRY_RUN", false);
        let candidate_limit = env_u64("GATEWAY_SIGNER_CANDIDATE_LIMIT", 50).max(1) as usize;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("reqwest client builder");

        Ok(Some(Self {
            api_url,
            circle_api,
            interval,
            dry_run,
            candidate_limit,
            signer,
            signer_key_hex: signer_key_hex.to_string(),
            http,
        }))
    }

    pub async fn run(self) {
        info!(
            api_url = %self.api_url,
            circle_api = %self.circle_api,
            signer = ?self.signer.address(),
            dry_run = self.dry_run,
            interval_ms = self.interval.as_millis() as u64,
            "gateway signer enabled"
        );

        loop {
            if let Err(e) = self.scan_once().await {
                warn!(error = ?e, "gateway signer scan failed");
            }
            sleep(self.interval).await;
        }
    }

    async fn scan_once(&self) -> Result<(), GatewaySignerError> {
        let (contexts, routes) = self.fetch_contexts_and_routes().await?;
        if contexts.is_empty() {
            debug!("gateway signer: no prepared contexts");
            return Ok(());
        }

        let mut attested = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;

        for context in contexts {
            let Some(route) = routes.get(&context.route_id) else {
                skipped += 1;
                warn!(
                    request_id = ?context.request_id,
                    chain_id = context.chain_id,
                    route = ?context.route_id,
                    "gateway signer: route config missing"
                );
                continue;
            };
            match self.process_context(context, route).await {
                Ok(GatewayOutcome::Attested(tx)) => {
                    attested += 1;
                    info!(tx = ?tx, "gateway signer: mint attestation submitted");
                }
                Ok(GatewayOutcome::DryRun) | Ok(GatewayOutcome::Skipped) => {
                    skipped += 1;
                }
                Err(e) => {
                    failed += 1;
                    warn!(error = ?e, "gateway signer context failed");
                }
            }
        }

        info!(attested, skipped, failed, "gateway signer scan complete");
        Ok(())
    }

    async fn fetch_contexts_and_routes(
        &self,
    ) -> Result<(Vec<GatewayContext>, RouteMap), GatewaySignerError> {
        let request = GraphQlRequest {
            query: CONTEXTS_QUERY,
            variables: json!({ "limit": self.candidate_limit as i64 }),
        };
        let url = format!("{}/graph", self.api_url);
        let res = self
            .http
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| GatewaySignerError::ApiHttp(format!("send {url}: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(GatewaySignerError::ApiHttp(format!(
                "graph status {status}: {body}"
            )));
        }
        let body: GraphQlResponse<GatewayData> = res
            .json()
            .await
            .map_err(|e| GatewaySignerError::ApiParse(e.to_string()))?;
        if let Some(errors) = body.errors.filter(|errs| !errs.is_empty()) {
            return Err(GatewaySignerError::ApiGraphql(
                errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<_>>()
                    .join("; "),
            ));
        }
        let data = body.data.unwrap_or_default();
        let routes = data
            .telarana_markets
            .into_iter()
            .filter_map(GatewayRoute::from_row)
            .map(|route| (route.route_id, route))
            .collect();
        let contexts = data
            .telarana_gateway_contexts
            .into_iter()
            .filter_map(GatewayContext::from_row)
            .collect();
        Ok((contexts, routes))
    }

    async fn process_context(
        &self,
        context: GatewayContext,
        route: &GatewayRoute,
    ) -> Result<GatewayOutcome, GatewaySignerError> {
        if !route.enabled {
            return Ok(GatewayOutcome::Skipped);
        }
        if context.amount == U256::ZERO {
            return Ok(GatewayOutcome::Skipped);
        }
        if context.source_signer != self.signer.address() {
            warn!(
                request_id = ?context.request_id,
                source_signer = ?context.source_signer,
                keeper = ?self.signer.address(),
                "gateway signer: sourceSigner does not match keeper key; skipping"
            );
            return Ok(GatewayOutcome::Skipped);
        }

        let destination_chain_id = chain_id_for_domain(route.destination_domain)?;
        let destination_rpc = rpc_url_for_chain(destination_chain_id)?;
        let destination_provider = ProviderBuilder::new()
            .connect_http(destination_rpc);
        let read_contract = TelaranaGatewayHubHookContract::new(
            context.telarana_gateway_hook,
            &destination_provider,
        );
        let state = read_contract
            .gatewayRequestState(context.request_id)
            .call()
            .await
            .map_err(|e| GatewaySignerError::Onchain(format!("gatewayRequestState: {e}")))?;
        if state != 0 {
            return Ok(GatewayOutcome::Skipped);
        }

        if self.dry_run {
            info!(
                request_id = ?context.request_id,
                route = ?context.route_id,
                amount = %context.amount,
                "gateway signer dry-run context"
            );
            return Ok(GatewayOutcome::DryRun);
        }

        let intent = self.build_signed_intent(&context, route).await?;
        let attestation = self.request_attestation(&intent).await?;

        let signer: PrivateKeySigner =
            self.signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    GatewaySignerError::Onchain(format!("invalid signer: {e}"))
                })?;
        let wallet = EthereumWallet::from(signer);
        let provider = ProviderBuilder::new()
            .wallet(wallet)
            .connect_http(rpc_url_for_chain(destination_chain_id)?);
        let contract =
            TelaranaGatewayHubHookContract::new(context.telarana_gateway_hook, &provider);
        let tx_context = TelaranaGatewayHubHookContract::GatewayMintContext {
            routeId: context.route_id,
            requestId: context.request_id,
            action: context.gateway_action,
            sourceDepositor: context.source_depositor,
            sourceSigner: context.source_signer,
            recipient: context.recipient,
            tokenOut: context.token_out,
            amount: context.amount,
            minAmountOut: context.min_amount_out,
            spotRouteId: context.spot_route_id,
            metadataRef: context.metadata_ref,
            hookData: Bytes::new(),
        };
        let pending = contract
            .receiveGatewayMint(
                attestation.attestation_payload,
                attestation.signature,
                tx_context,
            )
            .send()
            .await
            .map_err(|e| GatewaySignerError::Onchain(format!("receiveGatewayMint send: {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| GatewaySignerError::Onchain(format!("receiveGatewayMint receipt: {e}")))?;
        let tx = receipt.transaction_hash;
        if !receipt.status() {
            return Err(GatewaySignerError::Onchain(format!(
                "receiveGatewayMint reverted (tx {tx:#x})"
            )));
        }
        Ok(GatewayOutcome::Attested(tx))
    }

    async fn build_signed_intent(
        &self,
        context: &GatewayContext,
        route: &GatewayRoute,
    ) -> Result<SignedBurnIntent, GatewaySignerError> {
        let source_chain_id = chain_id_for_domain(route.source_domain)?;
        let source_provider = ProviderBuilder::new().connect_http(rpc_url_for_chain(source_chain_id)?);
        let head = source_provider
            .get_block_number()
            .await
            .map_err(|e| GatewaySignerError::Onchain(format!("source head: {e}")))?;
        let max_block_height = head.saturating_add(block_window_for_domain(route.source_domain));

        let transfer = TransferSpec {
            version: 1,
            sourceDomain: route.source_domain,
            destinationDomain: route.destination_domain,
            sourceContract: address_to_bytes32(route.source_gateway_wallet),
            destinationContract: address_to_bytes32(route.destination_gateway_minter),
            sourceToken: address_to_bytes32(route.source_usdc),
            destinationToken: address_to_bytes32(route.destination_usdc),
            sourceDepositor: address_to_bytes32(context.source_depositor),
            destinationRecipient: address_to_bytes32(context.telarana_gateway_hook),
            sourceSigner: address_to_bytes32(context.source_signer),
            destinationCaller: address_to_bytes32(context.telarana_gateway_hook),
            value: context.amount,
            salt: context.request_id,
            hookData: Bytes::new(),
        };
        let intent = BurnIntent {
            maxBlockHeight: U256::from(max_block_height),
            maxFee: U256::from(env_u64("GATEWAY_SIGNER_MAX_FEE", DEFAULT_MAX_FEE)),
            spec: transfer,
        };
        let domain = eip712_domain! {
            name: "GatewayWallet",
            version: "1",
        };
        let digest = intent.eip712_signing_hash(&domain);
        let signature = self
            .signer
            .sign_hash_sync(&digest)
            .map_err(|e: alloy_signer::Error| GatewaySignerError::Signing(e.to_string()))?;
        Ok(SignedBurnIntent { intent, signature })
    }

    async fn request_attestation(
        &self,
        signed: &SignedBurnIntent,
    ) -> Result<GatewayAttestation, GatewaySignerError> {
        let body = json!([
            {
                "burnIntent": burn_intent_json(&signed.intent),
                "signature": signature_hex(&signed.signature),
            }
        ]);
        let url = format!("{}/transfer", self.circle_api);
        let res = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| GatewaySignerError::Circle(format!("send {url}: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(GatewaySignerError::Circle(format!(
                "transfer status {status}: {body}"
            )));
        }
        let response: CircleTransferResponse = res
            .json()
            .await
            .map_err(|e| GatewaySignerError::Circle(format!("parse response: {e}")))?;
        if response.success == Some(false) {
            return Err(GatewaySignerError::Circle(
                response
                    .message
                    .unwrap_or_else(|| "transfer rejected".to_string()),
            ));
        }
        let attestation = response
            .attestation
            .ok_or_else(|| GatewaySignerError::Circle("missing attestation".to_string()))?;
        let signature = response
            .signature
            .ok_or_else(|| GatewaySignerError::Circle("missing signature".to_string()))?;
        Ok(GatewayAttestation {
            attestation_payload: parse_bytes(&attestation)
                .map_err(|e| GatewaySignerError::Circle(format!("attestation hex: {e}")))?,
            signature: parse_bytes(&signature)
                .map_err(|e| GatewaySignerError::Circle(format!("signature hex: {e}")))?,
        })
    }
}

type RouteMap = BTreeMap<B256, GatewayRoute>;

enum GatewayOutcome {
    Attested(B256),
    DryRun,
    Skipped,
}

struct SignedBurnIntent {
    intent: BurnIntent,
    signature: PrimitiveSignature,
}

struct GatewayAttestation {
    attestation_payload: Bytes,
    signature: Bytes,
}

#[derive(Debug, serde::Serialize)]
struct GraphQlRequest<'a> {
    query: &'a str,
    variables: Value,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Default, Deserialize)]
struct GatewayData {
    #[serde(default, rename = "TelaranaGatewayContext")]
    telarana_gateway_contexts: Vec<GatewayContextRow>,
    #[serde(default, rename = "TelaranaMarket")]
    telarana_markets: Vec<GatewayRouteRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayContextRow {
    id: String,
    chain_id: u64,
    route_id: String,
    telarana_gateway_hook: String,
    gateway_action: u8,
    source_depositor: String,
    source_signer: String,
    recipient: String,
    token_out: String,
    amount: String,
    min_amount_out: String,
    spot_route_id: String,
    metadata_ref: String,
}

#[derive(Debug, Clone)]
struct GatewayContext {
    request_id: B256,
    chain_id: u64,
    route_id: B256,
    telarana_gateway_hook: Address,
    gateway_action: u8,
    source_depositor: Address,
    source_signer: Address,
    recipient: Address,
    token_out: Address,
    amount: U256,
    min_amount_out: U256,
    spot_route_id: B256,
    metadata_ref: B256,
}

impl GatewayContext {
    fn from_row(row: GatewayContextRow) -> Option<Self> {
        Some(Self {
            request_id: parse_b256(&row.id)?,
            chain_id: row.chain_id,
            route_id: parse_b256(&row.route_id)?,
            telarana_gateway_hook: row.telarana_gateway_hook.parse().ok()?,
            gateway_action: row.gateway_action,
            source_depositor: row.source_depositor.parse().ok()?,
            source_signer: row.source_signer.parse().ok()?,
            recipient: row.recipient.parse().ok()?,
            token_out: row.token_out.parse().ok()?,
            amount: U256::from_str(row.amount.trim()).ok()?,
            min_amount_out: U256::from_str(row.min_amount_out.trim()).ok()?,
            spot_route_id: parse_b256(&row.spot_route_id)?,
            metadata_ref: parse_optional_b256(&row.metadata_ref),
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRouteRow {
    route_id: String,
    source_domain: u32,
    destination_domain: u32,
    source_usdc: String,
    destination_usdc: String,
    source_gateway_wallet: String,
    destination_gateway_minter: String,
    enabled: bool,
}

#[derive(Debug, Clone)]
struct GatewayRoute {
    route_id: B256,
    source_domain: u32,
    destination_domain: u32,
    source_usdc: Address,
    destination_usdc: Address,
    source_gateway_wallet: Address,
    destination_gateway_minter: Address,
    enabled: bool,
}

impl GatewayRoute {
    fn from_row(row: GatewayRouteRow) -> Option<Self> {
        Some(Self {
            route_id: parse_b256(&row.route_id)?,
            source_domain: row.source_domain,
            destination_domain: row.destination_domain,
            source_usdc: row.source_usdc.parse().ok()?,
            destination_usdc: row.destination_usdc.parse().ok()?,
            source_gateway_wallet: row.source_gateway_wallet.parse().ok()?,
            destination_gateway_minter: row.destination_gateway_minter.parse().ok()?,
            enabled: row.enabled,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CircleTransferResponse {
    success: Option<bool>,
    message: Option<String>,
    attestation: Option<String>,
    signature: Option<String>,
}

fn burn_intent_json(intent: &BurnIntent) -> Value {
    json!({
        "maxBlockHeight": intent.maxBlockHeight.to_string(),
        "maxFee": intent.maxFee.to_string(),
        "spec": {
            "version": intent.spec.version,
            "sourceDomain": intent.spec.sourceDomain,
            "destinationDomain": intent.spec.destinationDomain,
            "sourceContract": format!("{:#x}", intent.spec.sourceContract),
            "destinationContract": format!("{:#x}", intent.spec.destinationContract),
            "sourceToken": format!("{:#x}", intent.spec.sourceToken),
            "destinationToken": format!("{:#x}", intent.spec.destinationToken),
            "sourceDepositor": format!("{:#x}", intent.spec.sourceDepositor),
            "destinationRecipient": format!("{:#x}", intent.spec.destinationRecipient),
            "sourceSigner": format!("{:#x}", intent.spec.sourceSigner),
            "destinationCaller": format!("{:#x}", intent.spec.destinationCaller),
            "value": intent.spec.value.to_string(),
            "salt": format!("{:#x}", intent.spec.salt),
            "hookData": format!("0x{}", hex::encode(&intent.spec.hookData)),
        }
    })
}

fn signature_hex(sig: &PrimitiveSignature) -> String {
    let mut bytes = Vec::with_capacity(65);
    bytes.extend_from_slice(&sig.r().to_be_bytes::<32>());
    bytes.extend_from_slice(&sig.s().to_be_bytes::<32>());
    bytes.push(if sig.v() { 28 } else { 27 });
    format!("0x{}", hex::encode(bytes))
}

fn address_to_bytes32(address: Address) -> B256 {
    let mut out = [0u8; 32];
    out[12..].copy_from_slice(address.as_slice());
    B256::from(out)
}

fn parse_b256(raw: &str) -> Option<B256> {
    B256::from_str(raw).ok()
}

fn parse_optional_b256(raw: &str) -> B256 {
    if raw.is_empty() {
        B256::ZERO
    } else {
        B256::from_str(raw).unwrap_or(B256::ZERO)
    }
}

fn parse_bytes(raw: &str) -> Result<Bytes, String> {
    Bytes::from_str(raw).map_err(|e| e.to_string())
}

fn rpc_url_for_chain(chain_id: u64) -> Result<reqwest::Url, GatewaySignerError> {
    let raw = match chain_id {
        ARC_CHAIN_ID => std::env::var("GATEWAY_SIGNER_ARC_RPC_URL")
            .or_else(|_| std::env::var("TELARANA_ARC_RPC_URL"))
            .or_else(|_| std::env::var("ARC_RPC_URL"))
            .unwrap_or_else(|_| DEFAULT_ARC_RPC_URL.to_string()),
        FUJI_CHAIN_ID => std::env::var("GATEWAY_SIGNER_FUJI_RPC_URL")
            .or_else(|_| std::env::var("TELARANA_FUJI_RPC_URL"))
            .or_else(|_| std::env::var("FUJI_RPC_URL"))
            .unwrap_or_else(|_| DEFAULT_FUJI_RPC_URL.to_string()),
        other => {
            return Err(GatewaySignerError::InvalidRpcUrl {
                chain_id: other,
                reason: "unsupported hub chain".to_string(),
            })
        }
    };
    raw.parse::<reqwest::Url>()
        .map_err(|e| GatewaySignerError::InvalidRpcUrl {
            chain_id,
            reason: e.to_string(),
        })
}

fn chain_id_for_domain(domain: u32) -> Result<u64, GatewaySignerError> {
    match domain {
        ARC_DOMAIN => Ok(ARC_CHAIN_ID),
        FUJI_DOMAIN => Ok(FUJI_CHAIN_ID),
        other => Err(GatewaySignerError::UnsupportedDomain(other)),
    }
}

fn block_window_for_domain(domain: u32) -> u64 {
    let default = match domain {
        FUJI_DOMAIN => 1_800,
        ARC_DOMAIN => 3_600,
        _ => 3_600,
    };
    env_u64("GATEWAY_SIGNER_BLOCK_WINDOW", default)
        .max(1)
        .min(MAX_BLOCK_WINDOW)
}

fn normalize_url(raw: &str) -> Result<String, String> {
    let parsed: reqwest::Url = raw.parse().map_err(|e: url::ParseError| e.to_string())?;
    let mut out = parsed.to_string();
    while out.ends_with('/') {
        out.pop();
    }
    Ok(out)
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(default)
}

fn env_bool(name: &str, default: bool) -> bool {
    std::env::var(name)
        .map(|raw| {
            matches!(
                raw.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}
