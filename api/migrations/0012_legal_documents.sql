CREATE TYPE legal_document_type AS ENUM ('terms', 'privacy');

CREATE TABLE legal_documents (
  id SERIAL PRIMARY KEY,
  document_type legal_document_type NOT NULL,
  version VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  published_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMP NOT NULL DEFAULT now(),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX legal_documents_type_active_idx
  ON legal_documents (document_type, is_active, published_at DESC);

CREATE TABLE user_legal_acceptances (
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type legal_document_type NOT NULL,
  version VARCHAR(50) NOT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_type)
);

CREATE INDEX user_legal_acceptances_lookup_idx
  ON user_legal_acceptances (user_id, document_type);

INSERT INTO legal_documents (document_type, version, title, content, is_active)
VALUES
  ('terms', '1.0.0', 'Terms of Use', 'By using CoderClawLink, you agree to these Terms of Use. Continued use of the service indicates acceptance of current terms.', true),
  ('privacy', '1.0.0', 'Privacy Policy', 'CoderClawLink processes account, usage, and operational metadata to provide and secure the service.', true);