-- Allow businesses to exist without a DID (number provisioned later via self-serve)
ALTER TABLE businesses ALTER COLUMN did DROP NOT NULL;
