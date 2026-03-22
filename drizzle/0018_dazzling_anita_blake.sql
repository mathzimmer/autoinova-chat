CREATE TABLE `aiAgents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`systemPrompt` text NOT NULL,
	`includeCoreLayers` boolean NOT NULL DEFAULT true,
	`model` varchar(100) NOT NULL DEFAULT 'gpt-4o-mini',
	`temperature` decimal(2,1) NOT NULL DEFAULT '0.7',
	`maxTokens` int NOT NULL DEFAULT 1024,
	`enabledTools` json,
	`active` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiAgents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chatFlows` ADD `agentId` int;