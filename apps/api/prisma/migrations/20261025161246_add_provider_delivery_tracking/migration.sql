-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "providerAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "providerMessageId" TEXT;
