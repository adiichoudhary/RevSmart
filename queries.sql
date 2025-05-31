-- USER TABLE --
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    user_name VARCHAR(30) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL
);

-- TOPICS TABLE --
CREATE TABLE topics (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    subject_name VARCHAR(100) NOT NULL,
    topic_name VARCHAR(255) NOT NULL,
    initial_study_date DATE NOT NULL,
    next_revision_date DATE NOT NULL,
    current_interval INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    repetitions INTEGER DEFAULT 0,
    easiness REAL DEFAULT 2.5,
    CONSTRAINT topics_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

-- REVISION TABLE --
CREATE TABLE revisions (
    id SERIAL PRIMARY KEY,
    topic_id INTEGER,
    revision_date DATE NOT NULL,
    retention_rating INTEGER CHECK (retention_rating >= 0 AND retention_rating <= 5),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT revisions_topic_id_fkey FOREIGN KEY (topic_id)
        REFERENCES topics(id)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

-- SESSION TABLE --
CREATE TABLE user_sessions (
    sid VARCHAR(255) NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP WITHOUT TIME ZONE NOT NULL
);


