# BUFX Deployment Registry

Last updated: 2026-05-27

Cross-referenced against four data sources:
1. `fx-telarana/deployments/*.json` (canonical deployment manifests)
2. `defi-web-app/packages/contracts/src/index.ts` (app registry)
3. `defi-web-app/packages/contracts/src/{bento,telarana,perps-deployments}.ts` (sub-registries)
4. `defi-web-app/services/envio-yield/config.yaml` (Envio indexer)

On-chain verification via `cast code <addr> --rpc-url <rpc>`.

---

## A. Perps Stack -- Arc Testnet (5042002)

**Live stack** (from `perps-5042002.json`, wired in `CONTRACTS[5042002].perps`):

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| FxPerpClearinghouse | `0x7707d108F6Ce3d95ceA38D3965448F00C21CaFdC` | yes | yes | yes |
| FxOrderSettlement | `0xCeae7846c8ED2Dd9E6f541798a657875305EA0d8` | yes | yes | yes |
| FxMarginAccount | `0x77BBAef17257AD4800BE12A5D36AF87f3a49FBb7` | yes | -- | yes |
| FxFundingEngine | `0xE08a146B9081A8dd32203fC5e7B5988352489518` | yes | yes | yes |
| FxHealthChecker | `0x234E06a0761cde322E4Fc5065A8256247669F362` | yes | -- | yes |
| FxLiquidationEngine | `0x18DEA7845c36d45AaDbcCeC04aC6cFc103748D80` | yes | -- | yes |
| LiquidationRouter | `0xc98c0DAAe36F8755933051419c6919bFC038152d` | **NO** | -- | yes |
| FxOracle (perps) | `0xF181caF51bD2450211CB9e72d5Cc853d3789698B` | yes (via telarana.fxOracle) | yes | yes |

**Stale `perps-deployments.ts` (perps-arc-testnet.json)** -- old generation, different addresses:

| Contract | Address | Notes |
|----------|---------|-------|
| FxPerpClearinghouse | `0x6A265045D9A3291D2881d77DDC62e2781A2418c5` | Old gen, superseded |
| FxOrderSettlement | `0x0F62FCdA2de63d905Cb167301C00251A9bB6dAa1` | Old gen, superseded |
| FxMarginAccount | `0x35c7cD02cFa0c2889547482B71c1a5114d8439C6` | Old gen, superseded |
| FxFundingEngine | `0x88B70872759E1aA24858746779Cb15ca9F2cdcf3` | Old gen, superseded |
| FxHealthChecker | `0x272305e821D810eC5741761F98DbDC273efD47E6` | Old gen, superseded |
| FxLiquidationEngine | `0xD384560E5f8CE969BF4C1BDfAFACc5304AFbe8f2` | Old gen, superseded |

> **GAP**: `perps-deployments.ts` still exports old-gen addresses. `CONTRACTS[5042002].perps` has the correct live addresses.

---

## B. Spot Stack -- Arc Testnet (5042002)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| FxSpotExecutor | `0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f` | yes | yes | yes |
| FxMarketRegistry | `0x813232259c9b922e7571F15220617C80581f1464` | yes | -- | yes |

---

## C. Yield Engine -- Arc Testnet (5042002)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| TurboFeeVault | `0x929e222CBbC154f8e75a8DEF951288886Df70531` | **NO** | yes | yes |
| FxHedgeHook | `0x466e2BBFbF3D2Ca1a90eCf25fFF1e275b548C540` | **NO** | yes | yes |
| PoolManager (v4 hedge) | `0x403Aa1347a77195FB4dEddc362758AA9e0a48D2E` | **NO** | -- | yes |
| PoolManager (v4 bento) | `0x3FA22b7Aeda9ebBe34732ea394f1711887363B34` | yes (bento) | -- | yes |

---

## D. Telarana Gateway

### Arc Testnet (5042002)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| TelaranaGatewayHubHook | `0x74E894aFf25c89d707873347cd2554d30E0541fa` | yes | yes | yes |
| FxHubMessageReceiver | `0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C` | yes | -- | yes |
| FxGatewayHook | `0x2931C50745334d6DFf9eC4E3106fE05b49717DF1` | yes | -- | yes |
| FxOracle (Telarana hub) | `0x77b3A3B420dB98B01085b8C46a753Ed9879e2865` | **NO** (index.ts uses perps oracle) | yes (as FxOracle) | yes |
| FxSwapHook (v4 PMM) | `0xC6F894f30d0D28972C876B4af58C02A4E88A0aC8` | **NO** | -- | yes |
| TGH (wave N6 gateway pool) | `0xe895CB461AFF6E98167a7FA0Db252ba906714088` | **NO** | -- | yes |

### Avalanche Fuji (43113)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| FxHubMessageReceiver | `0x7eAdfD0c08dd6544f763285bBD31be14179d594B` | yes | yes (43113) | yes |
| FxGatewayHook | `0x7dA191bfB85D9F14069228cf618519BFb41f371E` | yes | -- | yes |
| FxOracle (Fuji hub) | `0xf7fcdca3f9c92418a980a31df7f87de7e1a1a04b` | **NO** | -- | yes |
| TelaranaGatewayHubHook (Fuji) | `0x6e1643cdA9B593349913F933dD7B960B8B52D1d0` | **NO** | -- | not checked |

---

## E. Morpho Lending

### Arc Testnet -- Own MorphoBlue (5042002)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| MorphoBlue (own) | `0x3c9b95C6E7B23f094f066733E7797C8680760830` | yes (telarana) | -- | yes |
| IrmMock | `0x8CC1B64D712eE2ff2891D56a5108eC4FDa73b9c1` | yes (telarana) | -- | yes |

Market IDs (own MorphoBlue):

| Market | ID | Hub |
|--------|----|-----|
| M1_EURC_USDC | `0xf6fac2b9b801a7ae3deeccfa95a7f1e768b4873a22f0def0d93f7f0172cc2da2` | Arc |
| M2_USDC_EURC | `0x9e187a5f252de56b9ffe35f72cdc4137568f9d51698560751cdaff3df60cb5d3` | Arc |
| M3_AUDF_USDC | `0x9053f4eeb53341cc43953030d52023d84aa9c1ad0cacb2312cdfc76078b227a4` | Arc |
| M4_USDC_AUDF | `0x6ffe9245d0750dc7190730f03b2a8f7bbcf91b5f80fea88388d68a4eabc6daad` | Arc |

### Arc Testnet -- Morpho Labs MorphoBlue (5042002)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| MorphoBlue (Labs) | `0x65f435eB4FF05f1481618694bC1ff7Ee4680c0A4` | **NO** | yes (Envio) | yes |
| AdaptiveCurveIrm | `0xBD583cc9807980f9e41f7c8250f594fB6173abE3` | **NO** | -- | yes |

Labs canonical Morpho market IDs (collateral -> USDC loan):

| Market | ID |
|--------|----|
| USDC_MXNB | `0x64c65920ab4d9565b8f5a99ba8b209e9a4ccad0a9ef4a4f60b926cfa73872558` |
| USDC_QCAD | `0xd5987f44b0ecb725e800435d91bfa3fc5217177951753ca8a06ee9d40c4dbb8c` |
| USDC_cirBTC | `0xa1abaefec3fcc67588b43f62509609fc03c2417352b30afe6aa9bdd87e02910d` |

Labs asset-loan market IDs (USDC collateral -> asset loan):

| Market | ID |
|--------|----|
| EURC_USDC | `0xc33f06b5df4ce120966271e4a1f8717d9c3b4476f088395b7f42c361ae097426` |
| MXNB_USDC | `0xcbc0175226391f9be3c3fdbaca39acc1a3c725e4f7ba2acf092bb0d2eaea69a0` |
| QCAD_USDC | `0x0094d4a3a41162209f1f3647f6d5ce645fe738d726690ac839784164b20b532a` |
| cirBTC_USDC | `0x4c5cc68edd1556042c695cbda31866322d649ed130af60fb05bc82f804c7a3cb` |
| AUDF_USDC | `0xbef2a3d3dc35251c995d843796aaa2b758d3c24342e39713aa307e6d02859536` |

Labs cirBTC-specific market IDs:

| Market | ID |
|--------|----|
| M1_EURC_USDC | `0xd6df807c0d926b71f0e5b6bcb2c8ec4c6c428dbf0e086f4c8161cba4820cb758` |
| M2_USDC_EURC | `0x5215cf63c19cce7e987978568a4016b2d32886fff4483d18b8c7ea1c8da14322` |
| M3_cirBTC_USDC | `0x93ba0392736409d220980f7c96d1fee499ca6d7c5785b7add0073a4c6ac11186` |
| M4_USDC_cirBTC | `0x11c03839da6619c3c11014cfd505af62f34bf3ed7c2f876c7153480300fafe83` |

### Avalanche Fuji (43113)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| MorphoBlue | `0xeF64621D41093144D9ED8aB8327eE381ECdB79E6` | yes (telarana) | yes (43113) | yes |
| MockEURC | `0x50c4ba39caa7f56152d0df4914e1f6b907194992` | yes (telarana) | -- | yes |

Market IDs (Fuji):

| Market | ID |
|--------|----|
| M1_EURC_USDC | `0x7d99088a9fe61331c49a92eb16fa3794b0bc2862b211f5a70f31a64cef25029e` |
| M2_USDC_EURC | `0x1700104cf29eceb113e01a1bcdc913e5e10d3d37314cee235752aa88bf153197` |
| M3_MXNB_USDC | `0x0a19c08b12d4cdb37ea4574886cb392ff5f4c7c2149bf5f7edb80d46dc03a617` |
| M4_USDC_MXNB | `0xfcd8ba3b7a6eca50f0936b7a640369e07956815d4828e22105a0af1532d82dcd` |

---

## F. Bento / Arcade

### Arc Testnet (5042002)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| FXBentoRoomFactory | `0x385bbd57d0dc2008e4446af7b12dcd158d56034d` | yes (bento) | yes | yes |
| FXBentoRoomEscrow | `0xab2f146507854334464c4b2326654775d9d947ed` | yes (bento) | yes | yes |
| FXBentoRoundManager | `0xfb956d033b15276da21579afd5f5b6bf6320869e` | yes (bento) | yes | yes |
| FXBentoCommitmentManager | `0x6b2c047fa0deb963a9ede1db7d0e4df258880414` | yes (bento) | yes | yes |
| FXBentoSettlementManager | `0x8f635571aaea4b1391534cd92932caa839e04bcd` | yes (bento) | yes | yes |
| FXBentoHook | `0xa6e3c9c2d6436feb24b165a8bcf6b454e96d50c0` | yes (bento) | -- | yes |
| PoolManager (Bento v4) | `0x3FA22b7Aeda9ebBe34732ea394f1711887363B34` | yes (bento) | -- | yes |
| PoolRegistry | `0x4d17c86866e6f0eab4908fe4cb4592e56e361084` | yes (bento) | -- | yes |
| ProtocolFeeVault | `0x468c241484f6aa6bd9555c9533074510dc7d6df1` | yes (bento) | -- | yes |

### Avalanche Fuji (43113)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| FXBentoRoomFactory | `0xc7ade54428d51b5d0ceb42e7dd5a47d48515ace1` | yes (bento) | yes (43113) | yes |
| FXBentoRoomEscrow | `0x5d10d2c3b9951054845534b2f60a68ebc0898cd3` | yes (bento) | yes (43113) | yes |
| FXBentoRoundManager | `0x27dbda42adb904115cade37c949bbf670e0ff09d` | yes (bento) | yes (43113) | yes |
| FXBentoCommitmentManager | `0xaad184861726627968718fde8b94ecac87eb5c5b` | yes (bento) | yes (43113) | yes |
| FXBentoSettlementManager | `0xa73208b62af9a87fb5e2b694b27f510d70e17746` | yes (bento) | yes (43113) | yes |
| FXBentoHook | `0x4959be2392a8a2ac27060c26c8f7d070ada9d0c0` | yes (bento) | -- | yes |
| PoolManager (Bento v4 Fuji) | `0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C` | yes (bento) | -- | yes |
| PoolRegistry | `0x2931c50745334d6dff9ec4e3106fe05b49717df1` | yes (bento) | -- | yes |
| ProtocolFeeVault | `0x7ac83373c6b74c7c5b0eee80fb36239a451dc899` | yes (bento) | -- | yes |

> **NOTE**: `CONTRACTS[5042002].bento` and `CONTRACTS[43113].bento` in `index.ts` are both empty `{}`. Bento addresses live exclusively in `bento.ts` sub-registry.

---

## G. BuFx Request Routers

### Arc Testnet (5042002)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| VenueRequestRouter | `0xa73208b62AF9a87fb5e2b694B27f510D70e17746` | yes | yes | yes |
| TelaranaRequestRouter | `0xea11AfDc70eD0489346AC9d488C17155384B459c` | yes | yes | yes |
| FeeConfig | `0x746e727E3aa25050c24a80E27E3bAEd9Ec6DdF6C` | yes | -- | yes |
| FeeCollector | `0x27DbdA42aDb904115cAdE37C949bBF670E0FF09d` | yes | -- | yes |

### Avalanche Fuji (43113)

| Contract | Address | In App Registry | In Envio | On-chain |
|----------|---------|----------------|----------|----------|
| VenueRequestRouter | `0x84EE03C52B89B01315C9572520192274b570D2c3` | yes | yes (43113) | yes |
| TelaranaRequestRouter | `0x46cC11feD4F497C0C091b7bE5a1A21af133c26f1` | yes | yes (43113) | yes |
| FeeConfig | `0xa589040434735710aEF173e31e421a2d0a20Dd17` | yes | -- | yes |
| FeeCollector | `0x1894C8c84F3a8DD1e17B237008a197feD2E299B6` | yes | -- | yes |

---

## H. Spoke Chains

Each spoke has two contracts: `FxSpoke` (routes to Fuji hub) and `FxSpokeToArc` (routes to Arc hub).

| Chain | ChainID | FxSpoke (->Fuji) | FxSpokeToArc (->Arc) | On-chain |
|-------|---------|-----------------|---------------------|----------|
| Ethereum Sepolia | 11155111 | `0xf6d845da2051183b9519ca1806c39040ba5e71ba` | `0x4e63954685241c4469f02fec3761ff1d4f34ffa9` | yes |
| Arbitrum Sepolia | 421614 | `0x2900599ff0e6dd057493d62fac856e5a8f93c6eb` | `0x365de300dda61c81a33bce3606a5d524ed964362` | yes |
| Base Sepolia | 84532 | (no spoke -- has full hub stack) | -- | N/A |
| OP Sepolia | 11155420 | `0x0b5d18bbe92f07ec0111ae6d2e102858268d6aca` | `0x579fccdebb1f7e983c4ead27aa300d3b5397e28c` | yes |
| Polygon Amoy | 80002 | `0xf7fcdca3f9c92418a980a31df7f87de7e1a1a04b` | `0x7882d3f0e210128a4dce51e1af1ec801e21e1e5a` | yes |
| Worldchain Sepolia | 4801 | `0x0b5d18bbe92f07ec0111ae6d2e102858268d6aca` | `0x579fccdebb1f7e983c4ead27aa300d3b5397e28c` | yes |
| Unichain Sepolia | 1301 | `0xf7fcdca3f9c92418a980a31df7f87de7e1a1a04b` | `0x7882d3f0e210128a4dce51e1af1ec801e21e1e5a` | yes |
| Avalanche Fuji | 43113 | `0xb7fc291c27f6a7a659d4d229e5d8a55e58f26ab1` | `0xe22ef07a0996df9ae6252cc9bf491fbe13fd6575` | yes |
| Arc Testnet | 5042002 | `0x13c8463589d460db6f21235eedfd678c22a1ea25` | `0x5d10d2c3b9951054845534b2f60a68ebc0898cd3` | yes |

> **NOTE**: Spoke addresses are NOT in the `CONTRACTS` map in `index.ts`. They live only in `fx-telarana/deployments/*.json`. The frontend does not need them directly (deposits go through the SDK which reads the manifests).

---

## I. Tokens

### Arc Testnet (5042002)

| Token | Address | In App Registry | In Location | On-chain |
|-------|---------|----------------|-------------|----------|
| USDC | `0x3600000000000000000000000000000000000000` | yes | yes (6 dp) | yes |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | yes | yes (6 dp) | yes |
| JPYC | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` | yes | yes (18 dp) | yes |
| MXNB | `0x836F73Fbc370A9329Ba4957E47912DfDBA6BA461` | yes | yes (6 dp) | yes |
| QCAD | `0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d` | yes | **NO** | yes |
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | yes | yes (8 dp) | yes |
| AUDF | `0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b` | yes | yes (6 dp) | yes |

### Avalanche Fuji (43113)

| Token | Address | In App Registry | In Location | On-chain |
|-------|---------|----------------|-------------|----------|
| USDC | `0x5425890298aed601595a70AB815c96711a31Bc65` | yes | yes (6 dp) | yes |
| JPYC | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` | yes | yes (18 dp) | yes |
| EURC | -- | -- | yes (Circle testnet `0x5E44...c6B`) | -- |
| MXNB | -- | -- | yes (`0xAB99...eBb` Bitso testnet) | -- |

### Ethereum Sepolia (11155111)

| Token | Address | In Location |
|-------|---------|-------------|
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | yes (6 dp) |
| EURC | `0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4` | yes (6 dp) |
| JPYC | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` | yes (18 dp) |
| MXNB | `0x34D4CeBB03Af55b99B68342Ac4bD78e598D9A9fC` | yes (6 dp) |
| AUDF | `0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b` | yes (6 dp) |

### Arbitrum Sepolia (421614)

| Token | Address | In Location |
|-------|---------|-------------|
| USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | yes (6 dp) |
| MXNB | `0xb56E3E3769EfB85214Cb4fA42eBA198E9FDA92bf` | yes (6 dp) |

---

## J. Perps Markets -- Arc Testnet (5042002)

All 6 markets registered in `ARC_PERP_MARKETS` (index.ts):

| Market | Base Token | Market ID | Pyth Feed | In App |
|--------|-----------|-----------|-----------|--------|
| EURC/USDC | `0x89B5...D72a` (EURC) | `0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8` | `0x76fa85...fa5c` (EUR/USD) | yes |
| JPYC/USDC | `0xE7C3...c29` (JPYC) | `0x848d2b05de70986fa3661af2a50953b537f05066eedc33c18cde1bd12cdd0a2d` | `0xef2c98...fd52` (JPY/USD) | yes |
| MXNB/USDC | `0x836F...a461` (MXNB) | `0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3` | `0xe13b1c...77ca` (MXN/USD) | yes |
| CIRBTC/USDC | `0xf0C4...32BF` (cirBTC) | `0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a` | `0xe62df6...b43` (BTC/USD) | yes |
| AUDF/USDC | `0xd2a5...456b` (AUDF) | `0x921b564f97b14b7d73c12a72af4b7847fb5e3414f98cbe5fb5f1d8a3168c0a00` | `0x67a6f9...a80` (AUD/USD) | yes |
| QCAD/USDC | `0x23d7...825d` (QCAD) | `0x8ff4ca87809655d824803aa87eec8e3a7b15c73215aca5e72650c04072df4645` | `0x3112b0...ecca` (USD/CAD inverted) | yes |

Cross-chain BuFx protocol perp markets (Fuji -> Arc, in `BUFX_PROTOCOL_PERP_MARKETS`):

| Market | Market ID | Route | In App |
|--------|-----------|-------|--------|
| FX-USD-JPY | `0xfc3e288cc7282a2306120977dd76aef9f3ec4f90397fd1d4ac04e33d9ad09efb` | fujiToArcMintToHubUsdc | yes |
| FX-USD-MXN | `0xdc13fbc1a6ecb8104e2831592fb1e849faf65e7a596bfd1926ae1bc585ba2332` | fujiToArcMintToHubUsdc | yes |

---

## K. Privacy Pools (Arc Testnet, 5042002)

| Contract | Address | In App Registry | On-chain |
|----------|---------|----------------|----------|
| FxPrivacyEntrypoint (proxy) | `0xd11cddd1f04e850d3810a71608a49907c80f2736` | yes | yes |
| FxPrivacyEntrypoint (impl) | `0x4506441df7960b2cb2b600b0d37dfd3ea79fa92a` | yes | yes |
| FxFixedRateSwapAdapter | `0x3Fa1AcC89DFd52f6692F20b7E49cD58A306C27f2` | yes | yes |
| Pool USDC | `0xc11c216c9c7a36848b1d4276d223160c8b51988f` | yes | yes |
| Pool EURC | `0x7B4582CDE65c8cC00fE24B16dBA60472242d234c` | yes | yes |
| Pool MXNB | `0x441723FD6212EF7C95D0e04F59b2Eeb59838d4E7` | yes | yes |
| Pool QCAD | `0xF3bd84bDdaD66a3b1F94dF7de0aD34AB158f2De4` | yes | yes |
| Pool cirBTC | `0x2465806A9293A588867DD94b9A6aB5d47531E928` | yes | yes |
| Pool AUDF | `0x5BC0e0795D5ea842601220bd1f855e60Fad7E3D1` | yes | yes |
| CommitmentVerifier | `0x9056facd889a94e4acba8cbc4c8a81ed47ba8ea0` | yes | yes |
| WithdrawalVerifier | `0x7f0326cea0796e31ed38f01b1e8660faad7bb6ee` | yes | yes |
| PoseidonT3 | `0x3333333C0A88F9BE4fd23ed0536F9B6c427e3B93` | yes | yes |
| PoseidonT4 | `0x4443338EF595F44e0121df4C21102677B142ECF0` | yes | yes |

---

## L. Hyperlane (Arc Testnet)

| Contract | Address | In App Registry |
|----------|---------|----------------|
| Mailbox | `0x9316246c42436ad74d81c8f5c9b295da5f2a8EE9` | **NO** |
| TrustedRelayerIsm | `0x263DA0b912EFD06Ea3E8C954Dd2B60A3fdC79241` | **NO** |
| MerkleTreeHook | `0xccceb5B90d9C1d9c5f8CcF755E4f37A849C8Ca11` | **NO** |
| InterchainAccountRouter | `0x113A539625D208b5EcC59f300Be14b9b3508E559` | **NO** |

> Hyperlane infra is used for cross-chain messaging; not directly called by the frontend.

---

## M. External / Infrastructure

| Name | Address | Chain |
|------|---------|-------|
| Circle GatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | All |
| Circle GatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | All |
| CCTP TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | All |
| CCTP MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | All |
| Pyth (Arc) | `0x2880aB155794e7179c9eE2e38200202908C17B43` | 5042002 |
| Pyth (Fuji) | `0x23f0e8FAeE7bbb405E7A7C3d60138FCfd43d7509` | 43113 |

---

## Gaps

### 1. On-chain but NOT in app registry

| Contract | Address | Chain | Source |
|----------|---------|-------|--------|
| LiquidationRouter | `0xc98c0DAAe36F8755933051419c6919bFC038152d` | Arc 5042002 | `liquidation-router-5042002.json` |
| TurboFeeVault | `0x929e222CBbC154f8e75a8DEF951288886Df70531` | Arc 5042002 | `turbo-fee-vault-5042002.json` |
| FxHedgeHook | `0x466e2BBFbF3D2Ca1a90eCf25fFF1e275b548C540` | Arc 5042002 | `fx-hedge-hook-5042002.json` |
| PoolManager (v4 hedge) | `0x403Aa1347a77195FB4dEddc362758AA9e0a48D2E` | Arc 5042002 | `fx-hedge-hook-5042002.json` |
| FxSwapHook (v4 PMM) | `0xC6F894f30d0D28972C876B4af58C02A4E88A0aC8` | Arc 5042002 | `arc-testnet.json` |
| TGH (wave N6 gateway pool) | `0xe895CB461AFF6E98167a7FA0Db252ba906714088` | Arc 5042002 | `arc-testnet.json` |
| MorphoBlue (Labs) | `0x65f435eB4FF05f1481618694bC1ff7Ee4680c0A4` | Arc 5042002 | `morpho-arc-testnet.json` |
| FxOracle (Fuji hub) | `0xf7fcdca3f9c92418a980a31df7f87de7e1a1a04b` | Fuji 43113 | `telarana-avalanche-fuji.json` |
| TelaranaGatewayHubHook (Fuji) | `0x6e1643cdA9B593349913F933dD7B960B8B52D1d0` | Fuji 43113 | `hub-config-fuji.json` |

### 2. Stale addresses in app registry

| File | Issue |
|------|-------|
| `perps-deployments.ts` | Exports old-gen perps addresses (`0x6A265...`, `0x0F62F...`, etc.) from `perps-arc-testnet.json`. Live perps are in `CONTRACTS[5042002].perps` (correct addresses). The `Perps` barrel re-export from `index.ts` exposes the stale set. |

### 3. In app registry but NOT indexed by Envio (when relevant)

| Contract | Address | Chain | Note |
|----------|---------|-------|------|
| FxMarginAccount | `0x77BBAef17...` | Arc | No position events indexed |
| FxHealthChecker | `0x234E06a07...` | Arc | No health-check events indexed |
| FxLiquidationEngine | `0x18DEA7845...` | Arc | No liquidation events indexed |
| FxMarketRegistry | `0x813232259...` | Arc | Market config events not indexed |
| FxHubMessageReceiver (Arc) | `0x44B50E93e...` | Arc | Indexed on Fuji only (43113), not Arc (5042002) |
| FxGatewayHook (Arc) | `0x2931C5074...` | Arc | Not indexed |
| MorphoBlue (Labs, `0x65f4...`) | `0x65f435eB4...` | Arc | Envio indexes this but app registry does not reference it |

### 4. Missing from location/deployments.ts (balance reads)

| Token | Chain | Note |
|-------|-------|------|
| QCAD | Arc 5042002 | Present in `CONTRACTS[5042002].tokens.qcad` but missing from `packages/location/src/deployments.ts`. Wallet balances for QCAD on Arc will return null. |
| EURC | Fuji 43113 | Not in `CONTRACTS[43113].tokens` (only usdc, jpyc). Fuji location table has Circle EURC `0x5E44...c6B` -- correct for balance reads, but separate from the MockEURC used by Morpho markets. |

### 5. Envio indexes contract NOT in app registry

| Contract | Envio Address | Chain | Note |
|----------|--------------|-------|------|
| MorphoBlue | `0x65f435eB4FF05f1481618694bC1ff7Ee4680c0A4` | Arc 5042002 | Envio indexes the Labs MorphoBlue. App's telarana.ts uses the own MorphoBlue (`0x3c9b95...`). Both are live on-chain; frontend only wires the own one. |

### 6. Summary of action items

1. **Add QCAD to `packages/location/src/deployments.ts`** under chain 5042002 with address `0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d` and `decimals: 6`.
2. **Update `perps-deployments.ts`** (and `perps-arc-testnet.json`) to point at the live perps stack addresses from `perps-5042002.json`, or deprecate the file with a clear pointer to `CONTRACTS[5042002].perps`.
3. **Consider adding yield engine contracts** (TurboFeeVault, FxHedgeHook) to `index.ts` if the frontend needs to read vault APY or hedge state.
4. **Consider adding LiquidationRouter** to `index.ts` for keeper / liquidator UI surfaces.
5. **Add FxHubMessageReceiver to Envio on Arc chain** (currently only indexed on Fuji 43113).
