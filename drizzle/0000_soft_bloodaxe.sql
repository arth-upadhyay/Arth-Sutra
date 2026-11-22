CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`invoice_number` text DEFAULT '' NOT NULL,
	`invoice_date` text DEFAULT '' NOT NULL,
	`invoice_type` text DEFAULT 'tax-invoice' NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`total_tax_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`printed_count` integer DEFAULT 0 NOT NULL,
	`last_printed_at` text,
	`generated_from` text,
	`auto_generated` integer DEFAULT false NOT NULL,
	`auto_generated_at` text,
	`is_trashed` integer DEFAULT false NOT NULL,
	`trashed_at` text,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`pin` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`gstin` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`is_sez` integer DEFAULT false NOT NULL,
	`licence` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`gst_amount` real DEFAULT 0 NOT NULL,
	`gst_percent` real DEFAULT 0 NOT NULL,
	`vendor_name` text DEFAULT '' NOT NULL,
	`vendor_gstin` text DEFAULT '' NOT NULL,
	`invoice_no` text DEFAULT '' NOT NULL,
	`payment_mode` text DEFAULT '' NOT NULL,
	`interstate` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`hsn` text DEFAULT '' NOT NULL,
	`purchase_price` real DEFAULT 0 NOT NULL,
	`selling_price` real DEFAULT 0 NOT NULL,
	`rate` real DEFAULT 0 NOT NULL,
	`mrp` real DEFAULT 0 NOT NULL,
	`tax_percent` real DEFAULT 0 NOT NULL,
	`cess_percent` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`stock` real DEFAULT 0 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`pkg` text DEFAULT '' NOT NULL,
	`batches` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`business_name` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`pin` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`gstin` text DEFAULT '' NOT NULL,
	`pan` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`bank_name` text DEFAULT '' NOT NULL,
	`account_number` text DEFAULT '' NOT NULL,
	`ifsc` text DEFAULT '' NOT NULL,
	`swift` text DEFAULT '' NOT NULL,
	`logo` text DEFAULT '' NOT NULL,
	`signature` text DEFAULT '' NOT NULL,
	`upi_id` text DEFAULT '' NOT NULL,
	`google_client_id` text DEFAULT '' NOT NULL,
	`google_drive_folder` text DEFAULT 'GST Billing Invoices' NOT NULL,
	`payment_accounts` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`supplier_name` text DEFAULT '' NOT NULL,
	`supplier_address` text DEFAULT '' NOT NULL,
	`supplier_gstin` text DEFAULT '' NOT NULL,
	`invoice_number` text DEFAULT '' NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`total_tax` real DEFAULT 0 NOT NULL,
	`taxable_amount` real DEFAULT 0 NOT NULL,
	`apply_round_off` integer DEFAULT false NOT NULL,
	`round_off` real DEFAULT 0 NOT NULL,
	`payment_status` text DEFAULT 'Unpaid' NOT NULL,
	`interstate` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`items` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`receipt_no` text DEFAULT '' NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`client_address` text DEFAULT '' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`payment_mode` text DEFAULT '' NOT NULL,
	`reference_no` text DEFAULT '' NOT NULL,
	`against_invoice` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`bill_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring` (
	`id` text PRIMARY KEY NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`invoice_type` text DEFAULT 'tax-invoice' NOT NULL,
	`next_date` text DEFAULT '' NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL
);
