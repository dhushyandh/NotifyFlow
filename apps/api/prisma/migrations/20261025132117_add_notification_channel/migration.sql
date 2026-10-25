-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('sms', 'email');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "channel" "NotificationChannel" NOT NULL DEFAULT 'sms';
