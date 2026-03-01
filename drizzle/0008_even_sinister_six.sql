CREATE TABLE `followUpLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`phone` varchar(32) NOT NULL,
	`message` text NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`attemptNumber` int NOT NULL DEFAULT 1,
	CONSTRAINT `followUpLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metaAds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`campaignId` varchar(64) NOT NULL,
	`adSetId` varchar(64) NOT NULL,
	`adCreativeId` varchar(64) NOT NULL,
	`adId` varchar(64) NOT NULL,
	`imageHash` varchar(64),
	`adStatus` enum('paused','active','archived') NOT NULL DEFAULT 'paused',
	`dailyBudgetCents` int NOT NULL DEFAULT 3000,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`leads` int DEFAULT 0,
	`spendCents` int DEFAULT 0,
	`lastInsightSync` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `metaAds_id` PRIMARY KEY(`id`),
	CONSTRAINT `metaAds_adId_unique` UNIQUE(`adId`)
);
