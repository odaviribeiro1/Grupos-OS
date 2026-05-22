alter table if exists grupos.uazapi_config
  drop column if exists api_url,
  drop column if exists api_token,
  drop column if exists instance_token,
  drop column if exists openai_api_key,
  drop column if exists onboarding_completed;
