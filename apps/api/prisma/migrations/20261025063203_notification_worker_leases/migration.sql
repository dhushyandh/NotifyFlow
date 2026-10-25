-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" TEXT;
