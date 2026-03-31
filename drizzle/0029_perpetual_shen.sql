CREATE TABLE `contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`email` varchar(320),
	`tags` json,
	`notes` text,
	`contactSource` enum('manual','excel','whatsapp','lead') NOT NULL DEFAULT 'manual',
	`conversationId` int,
	`leadId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `templateSends` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contactId` int NOT NULL,
	`templateName` varchar(255) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`templateSendStatus` enum('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`sentBy` int,
	CONSTRAINT `templateSends_id` PRIMARY KEY(`id`)
);
