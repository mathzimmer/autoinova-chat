# Instagram Actor ID Fix

## Descoberta chave do StackOverflow:
O campo `instagram_actor_id` no endpoint `act_<AD_ACCOUNT_ID>/adcreatives` foi **deprecated na v22.0** e será deprecated para todas as versões em 20 de janeiro de 2026.

**Solução:** Migrar para usar o campo `instagram_user_id` em vez de `instagram_actor_id`.

## Referência:
- https://developers.facebook.com/docs/marketing-api/reference/ad-creative
- O comentário do C3roe no SO confirma que esse é provavelmente o problema.

## Ação:
1. Trocar `instagram_actor_id` por `instagram_user_id` no object_story_spec
2. O valor continua sendo o mesmo ID (17841408045575383)
