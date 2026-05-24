CREATE TABLE `evolutionConversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instanceId` int NOT NULL,
	`instanceName` varchar(100) NOT NULL,
	`remoteJid` varchar(100) NOT NULL,
	`phone` varchar(32),
	`contactName` varchar(255),
	`contactPhoto` varchar(512),
	`lastMessageAt` bigint,
	`lastMessagePreview` varchar(500),
	`unreadCount` int NOT NULL DEFAULT 0,
	`status` enum('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
	`leadStatus` varchar(50),
	`vehicleInterest` varchar(255),
	`notes` text,
	`tags` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `evolutionConversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evolutionInstances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instanceName` varchar(100) NOT NULL,
	`displayName` varchar(255),
	`phone` varchar(32),
	`sellerId` int,
	`assignedUserId` int,
	`status` enum('connecting','connected','disconnected','qr_code') NOT NULL DEFAULT 'disconnected',
	`qrCode` text,
	`profilePicUrl` varchar(512),
	`webhookConfigured` boolean NOT NULL DEFAULT false,
	`lastConnectedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `evolutionInstances_id` PRIMARY KEY(`id`),
	CONSTRAINT `evolutionInstances_instanceName_unique` UNIQUE(`instanceName`)
);
--> statement-breakpoint
CREATE TABLE `evolutionMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instanceId` int NOT NULL,
	`instanceName` varchar(100) NOT NULL,
	`conversationId` int,
	`remoteJid` varchar(100) NOT NULL,
	`messageId` varchar(255),
	`content` text,
	`messageType` enum('text','audio','image','document','video','sticker','reaction','system') NOT NULL DEFAULT 'text',
	`mediaUrl` varchar(512),
	`direction` enum('inbound','outbound') NOT NULL,
	`senderName` varchar(255),
	`status` enum('sent','delivered','read','failed') NOT NULL DEFAULT 'sent',
	`timestamp` bigint NOT NULL,
	`rawPayload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evolutionMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `evolutionMessages_messageId_unique` UNIQUE(`messageId`)
);
