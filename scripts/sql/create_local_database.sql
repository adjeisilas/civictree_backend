-- Creates the local development database and its user for CivicTree.
-- Replace CHANGE_ME_local_password with a password of your own, then put the same
-- value in .env as DATABASE_URL. Never use the production password here.
-- Run once:  mysql -u root -p < create_local_database.sql
-- Safe to re-run: it only creates things that are missing.

CREATE DATABASE IF NOT EXISTS `civirecy_civictree`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'civirecy_admin'@'localhost' IDENTIFIED BY 'CHANGE_ME_local_password';
CREATE USER IF NOT EXISTS 'civirecy_admin'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_local_password';

GRANT ALL PRIVILEGES ON `civirecy_civictree`.* TO 'civirecy_admin'@'localhost';
GRANT ALL PRIVILEGES ON `civirecy_civictree`.* TO 'civirecy_admin'@'127.0.0.1';

FLUSH PRIVILEGES;

SELECT 'Database and user are ready' AS status;
