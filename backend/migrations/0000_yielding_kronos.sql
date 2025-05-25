CREATE TABLE "desk_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"desk_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"redirect_email" text,
	"description" text,
	"is_default" boolean DEFAULT false,
	"smtp_host" text,
	"smtp_port" text,
	"smtp_user" text,
	"smtp_password" text,
	"smtp_secure" boolean DEFAULT false,
	"smtp_from_name" text,
	"use_direct_email" boolean DEFAULT false,
	"imap_host" text,
	"imap_port" text,
	"imap_user" text,
	"imap_password" text,
	"imap_secure" boolean DEFAULT false,
	"use_imap_polling" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "desks_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"content" text NOT NULL,
	"sender" text NOT NULL,
	"sender_email" text NOT NULL,
	"is_agent" boolean DEFAULT false NOT NULL,
	"message_id" text,
	"reference_ids" text,
	"in_reply_to" text,
	"cc_recipients" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_satisfaction_response" boolean DEFAULT false,
	"satisfaction_rating" integer,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"email_sent" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"desk_id" integer,
	"assigned_user_id" integer,
	"cc_recipients" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'agent' NOT NULL,
	"requires_setup" boolean DEFAULT false,
	"reset_token" text,
	"reset_token_expiry" timestamp,
	"otp_code" text,
	"otp_expiry" timestamp,
	"is_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "desk_assignments" ADD CONSTRAINT "desk_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_assignments" ADD CONSTRAINT "desk_assignments_desk_id_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."desks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_desk_id_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."desks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;