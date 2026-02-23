CREATE TABLE `aiLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`promptTokens` int DEFAULT 0,
	`completionTokens` int DEFAULT 0,
	`totalTokens` int DEFAULT 0,
	`costEstimate` varchar(20),
	`responseTimeMs` int,
	`toolUsed` varchar(100),
	`success` boolean DEFAULT true,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(32) NOT NULL,
	`contactName` varchar(255),
	`channel` enum('whatsapp','web','webhook') NOT NULL DEFAULT 'whatsapp',
	`status` enum('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
	`aiActive` boolean NOT NULL DEFAULT true,
	`assignedTo` int,
	`unreadCount` int NOT NULL DEFAULT 0,
	`lastMessageAt` bigint,
	`lastMessagePreview` varchar(500),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`phone` varchar(32) NOT NULL,
	`name` varchar(255),
	`intention` varchar(255),
	`vehicleInterest` varchar(500),
	`hasTrade` boolean,
	`tradeVehicle` varchar(255),
	`tradeYear` varchar(10),
	`tradeKm` varchar(50),
	`paymentMethod` varchar(255),
	`downPayment` varchar(100),
	`leadStatus` enum('new','qualifying','qualified','contacted','converted','lost') NOT NULL DEFAULT 'new',
	`score` int DEFAULT 0,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`content` text NOT NULL,
	`senderType` enum('customer','bot','agent') NOT NULL,
	`senderName` varchar(255),
	`messageType` enum('text','audio','image','document','system') NOT NULL DEFAULT 'text',
	`messageStatus` enum('sent','delivered','read','failed') NOT NULL DEFAULT 'sent',
	`metadata` json,
	`externalId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand` varchar(100) NOT NULL,
	`model` varchar(200) NOT NULL,
	`year` int NOT NULL,
	`price` int NOT NULL,
	`mileage` int,
	`color` varchar(50),
	`transmission` enum('manual','automatic') DEFAULT 'manual',
	`fuel` varchar(50),
	`category` varchar(100),
	`description` text,
	`imageUrl` varchar(500),
	`available` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vehicles_id` PRIMARY KEY(`id`)
);
