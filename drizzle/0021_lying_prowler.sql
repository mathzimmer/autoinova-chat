CREATE TABLE `sellerAssignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sellerId` int NOT NULL,
	`conversationId` int NOT NULL,
	`storeLocation` varchar(200) NOT NULL,
	`vehicleId` int,
	`customerPhone` varchar(32),
	`customerName` varchar(255),
	`sellerAssignmentStatus` enum('pending','contacted','completed','expired') NOT NULL DEFAULT 'pending',
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	`contactedAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `sellerAssignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sellerQueues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeLocation` varchar(200) NOT NULL,
	`currentIndex` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sellerQueues_id` PRIMARY KEY(`id`),
	CONSTRAINT `sellerQueues_storeLocation_unique` UNIQUE(`storeLocation`)
);
--> statement-breakpoint
CREATE TABLE `sellers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`storeLocation` varchar(200) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`totalAssignments` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sellers_id` PRIMARY KEY(`id`)
);
