ALTER TABLE `conversations` ADD `lastCustomerMessageAt` bigint;--> statement-breakpoint
ALTER TABLE `conversations` ADD `windowExpired` tinyint DEFAULT 0;--> statement-breakpoint
ALTER TABLE `messages` ADD `deliveryError` text;