/*
  Warnings:

  - The `status` column on the `Notification` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'queued', 'processing', 'sent', 'failed');

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "status",
ADD COLUMN     "status" "NotificationStatus" NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");
