CREATE TABLE `chatFlowEdges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flowId` int NOT NULL,
	`sourceNodeId` int NOT NULL,
	`targetNodeId` int NOT NULL,
	`sourceHandle` varchar(100) DEFAULT 'default',
	`edgeLabel` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chatFlowEdges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chatFlowNodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flowId` int NOT NULL,
	`nodeType` enum('start','send_message','send_buttons','send_list','send_image','condition','ai_response','update_lead','assign_agent','delay','end') NOT NULL,
	`label` varchar(255),
	`data` json NOT NULL,
	`positionX` int NOT NULL DEFAULT 0,
	`positionY` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chatFlowNodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chatFlowSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`flowId` int NOT NULL,
	`currentNodeId` int,
	`sessionStatus` enum('active','completed','paused','cancelled') NOT NULL DEFAULT 'active',
	`context` json,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chatFlowSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chatFlows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`flowTrigger` enum('first_contact','keyword','button_click','ad_click','manual','reactivation','category_interest') NOT NULL DEFAULT 'first_contact',
	`triggerValue` varchar(500),
	`active` boolean NOT NULL DEFAULT false,
	`priority` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chatFlows_id` PRIMARY KEY(`id`)
);
