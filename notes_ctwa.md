# Click to WhatsApp Ad Creative - Formato Correto

## Objetivos suportados:
- OUTCOME_ENGAGEMENT
- OUTCOME_LEADS
- OUTCOME_SALES
- OUTCOME_TRAFFIC

## object_story_spec para Click to WhatsApp:
```json
{
  "page_id": "<PAGE_ID>",
  "link_data": {
    "image_hash": "<IMAGE_HASH>",
    "call_to_action": {
      "type": "WHATSAPP_MESSAGE",
      "value": {
        "app_destination": "WHATSAPP"
      }
    },
    "link": "https://api.whatsapp.com/send",
    "name": "<AD_HEADLINE>",
    "page_welcome_message": "<JSON_STRING>"
  }
}
```

## Diferenças chave:
1. CTA type = "WHATSAPP_MESSAGE" (não "LEARN_MORE")
2. link = "https://api.whatsapp.com/send" (não link direto do WhatsApp)
3. value.app_destination = "WHATSAPP"
4. page_welcome_message é obrigatório para definir a mensagem de boas-vindas
5. O campo "message" (texto principal) fica FORA do link_data, no nível do post

## Para campanhas de Tráfego/Leads com link externo:
- CTA type = "LEARN_MORE" com link direto
- Sem page_welcome_message
