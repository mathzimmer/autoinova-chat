CREATE TABLE `leadSummaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`conversationId` int NOT NULL,
	`summaryDate` varchar(10) NOT NULL,
	`summary` text NOT NULL,
	`messageCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leadSummaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `city` varchar(255);