CREATE TABLE `whatsappNumberConversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`whatsappNumberId` int NOT NULL,
	`phoneNumberId` varchar(64) NOT NULL,
	`customerPhone` varchar(32) NOT NULL,
	`contactName` varchar(255),
	`contactPhoto` varchar(512),
	`lastMessageAt` bigint,
	`lastMessagePreview` varchar(500),
	`unreadCount` int NOT NULL DEFAULT 0,
	`wnConvStatus` enum('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
	`windowExpired` boolean NOT NULL DEFAULT false,
	`leadStatus` varchar(50),
	`vehicleInterest` varchar(255),
	`notes` text,
	`tags` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsappNumberConversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsappNumberMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`whatsappNumberId` int NOT NULL,
	`conversationId` int NOT NULL,
	`externalMessageId` varchar(255),
	`content` text,
	`wnMsgType` enum('text','audio','image','document','video','sticker','reaction','system') NOT NULL DEFAULT 'text',
	`mediaUrl` varchar(512),
	`wnDirection` enum('inbound','outbound') NOT NULL,
	`senderName` varchar(255),
	`wnMsgStatus` enum('sent','delivered','read','failed') NOT NULL DEFAULT 'sent',
	`timestamp` bigint NOT NULL,
	`rawPayload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsappNumberMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsappNumberMessages_externalMessageId_unique` UNIQUE(`externalMessageId`)
);
--> statement-breakpoint
CREATE TABLE `whatsappNumbers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phoneNumberId` varchar(64) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`phoneDisplay` varchar(32),
	`accessToken` text,
	`sellerId` int,
	`assignedUserId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsappNumbers_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsappNumbers_phoneNumberId_unique` UNIQUE(`phoneNumberId`)
);
