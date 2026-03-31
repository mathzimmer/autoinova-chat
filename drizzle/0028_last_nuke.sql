CREATE TABLE `rescueAttempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`leadId` int NOT NULL,
	`flowId` int,
	`attemptNumber` int NOT NULL DEFAULT 1,
	`rescueStatus` enum('sent','responded','expired','cancelled') NOT NULL DEFAULT 'sent',
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`respondedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rescueAttempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chatFlowNodes` MODIFY COLUMN `nodeType` enum('start','send_message','send_buttons','send_list','send_image','condition','ai_response','update_lead','assign_agent','delay','wait_input','end','goto_flow','assign_seller','send_vehicle_photos','vehicle_presentation','update_lead_status') NOT NULL;--> statement-breakpoint
ALTER TABLE `chatFlows` MODIFY COLUMN `flowTrigger` enum('first_contact','keyword','button_click','ad_click','manual','reactivation','category_interest','rescue') NOT NULL DEFAULT 'first_contact';--> statement-breakpoint
ALTER TABLE `leads` ADD `funnelStatus` enum('novo','interesse_definido','pagamento_definido','dados_pessoais','dados_troca','encaminhado_vendedor','negociando','fechado','perdido') DEFAULT 'novo' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `leadTemperature` enum('frio','morno','quente','muito_quente') DEFAULT 'frio' NOT NULL;