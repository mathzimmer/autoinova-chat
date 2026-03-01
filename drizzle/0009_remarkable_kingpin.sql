ALTER TABLE `metaAds` MODIFY COLUMN `vehicleId` int;--> statement-breakpoint
ALTER TABLE `metaAds` MODIFY COLUMN `adSetId` varchar(64);--> statement-breakpoint
ALTER TABLE `metaAds` MODIFY COLUMN `adCreativeId` varchar(64);--> statement-breakpoint
ALTER TABLE `metaAds` ADD `adName` varchar(500);--> statement-breakpoint
ALTER TABLE `metaAds` ADD `thumbnailUrl` text;--> statement-breakpoint
ALTER TABLE `metaAds` ADD `adSource` enum('crm','imported') DEFAULT 'crm' NOT NULL;