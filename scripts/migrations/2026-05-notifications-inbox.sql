-- 2026-05-17: In-app notifications inbox. One row per recipient per event.

CREATE TABLE IF NOT EXISTS notifications (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT NOT NULL,
  type          ENUM('mention','task_assigned','task_reassigned','comment_on_assigned') NOT NULL,
  task_id       INT NOT NULL,
  actor_user_id INT NOT NULL,
  excerpt       VARCHAR(280) DEFAULT NULL,
  is_read       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_recipient (user_id, is_read, created_at),
  CONSTRAINT fk_notif_user  FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_task  FOREIGN KEY (task_id)       REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
