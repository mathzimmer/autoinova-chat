CREATE TABLE `vendorApiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamMemberId` int NOT NULL,
	`apiKey` varchar(64) NOT NULL,
	`name` varchar(100),
	`active` boolean NOT NULL DEFAULT true,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vendorApiKeys_id` PRIMARY KEY(`id`),
	CONSTRAINT `vendorApiKeys_apiKey_unique` UNIQUE(`apiKey`)
);
