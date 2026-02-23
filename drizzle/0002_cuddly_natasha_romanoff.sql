ALTER TABLE `vehicles` MODIFY COLUMN `model` varchar(300) NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` MODIFY COLUMN `transmission` varchar(30) DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `vehicles` ADD `externalId` int;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `version` varchar(300);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `title` varchar(500);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `fabricYear` int;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `regularPrice` int;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `promotionPrice` int;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `vehicleCondition` varchar(30);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `doors` int;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `url` varchar(500);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `images` json;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `features` json;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `negotiation` varchar(100);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `plate` varchar(20);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `seller` varchar(200);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `locationCity` varchar(100);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `vehiclePhone` varchar(32);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `lastSyncedAt` timestamp;--> statement-breakpoint
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_externalId_unique` UNIQUE(`externalId`);