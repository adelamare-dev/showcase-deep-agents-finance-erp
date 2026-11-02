-- Finance ERP schema (no data rows: the agent service owns the demo data)

CREATE TYPE invoice_status AS ENUM ('paid', 'pending', 'overdue', 'draft');
CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE txn_type AS ENUM ('credit', 'debit');
CREATE TYPE txn_status AS ENUM ('completed', 'pending', 'failed');
CREATE TYPE emp_status AS ENUM ('active', 'on-leave', 'terminated');

CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR PRIMARY KEY,
    number VARCHAR UNIQUE NOT NULL,
    client VARCHAR NOT NULL,
    amount FLOAT NOT NULL,
    currency VARCHAR DEFAULT 'USD',
    status invoice_status DEFAULT 'draft',
    issued_date DATE,
    due_date DATE
);

CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR PRIMARY KEY,
    code VARCHAR UNIQUE NOT NULL,
    name VARCHAR NOT NULL,
    type account_type,
    balance FLOAT DEFAULT 0,
    currency VARCHAR DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR PRIMARY KEY,
    date DATE,
    description VARCHAR,
    amount FLOAT,
    type txn_type,
    category VARCHAR,
    account_code VARCHAR,
    status txn_status DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS inventory (
    id VARCHAR PRIMARY KEY,
    sku VARCHAR UNIQUE NOT NULL,
    name VARCHAR NOT NULL,
    category VARCHAR,
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 0,
    unit_cost FLOAT DEFAULT 0,
    location VARCHAR
);

CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    email VARCHAR UNIQUE,
    role VARCHAR,
    department VARCHAR,
    start_date DATE,
    status emp_status DEFAULT 'active',
    salary FLOAT DEFAULT 0
);
