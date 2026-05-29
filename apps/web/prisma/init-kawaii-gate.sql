-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "NftTier" AS ENUM ('testnet', 'mainnet', 'both');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('discord', 'telegram', 'x');

-- CreateTable
CREATE TABLE "gate_whitelist" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "tier" "NftTier" NOT NULL DEFAULT 'both',
    "source" TEXT,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_verifications" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT,
    "handle" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "social_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mints" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "tier" "NftTier" NOT NULL,
    "tokenId" TEXT,
    "txHash" TEXT,
    "payToken" TEXT NOT NULL,
    "amountPaid" TEXT,
    "recipient" TEXT,
    "ipfsCid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bento_mirror" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "gamePoints" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastRoomId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bento_mirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gate_whitelist_address_key" ON "gate_whitelist"("address");

-- CreateIndex
CREATE INDEX "social_verifications_address_idx" ON "social_verifications"("address");

-- CreateIndex
CREATE UNIQUE INDEX "social_verifications_address_platform_key" ON "social_verifications"("address", "platform");

-- CreateIndex
CREATE INDEX "mints_address_idx" ON "mints"("address");

-- CreateIndex
CREATE INDEX "mints_chainId_tier_idx" ON "mints"("chainId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "bento_mirror_address_key" ON "bento_mirror"("address");

-- CreateIndex
CREATE INDEX "bento_mirror_gamePoints_idx" ON "bento_mirror"("gamePoints");

