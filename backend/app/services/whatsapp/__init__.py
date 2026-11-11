"""
WhatsApp module (API side).

Layout
------
schema.sql / schema.py   shared DDL + one-time legacy migration (same file as the bridge)
settings.py              bridge URL / shared token / media storage configuration
bridge.py                HTTP client for the Node bridge (the only thing that talks to it)
repository.py            every SQL statement; all of them scoped by organization + connected number
serializers.py           row -> API JSON (display names, previews, signed media URLs)
media.py                 media storage (database or S3-compatible) and signed download URLs
realtime.py              Server-Sent-Events feed driven by a database cursor

Isolation rules enforced here
-----------------------------
* The inbox a request may touch is derived on the server from the caller's JWT:
  organization_id comes from the user, session_id (the connected phone number)
  from that user's own whatsapp_sessions row. Nothing scope-related is ever
  accepted from the client.
* WhatsApp chats never create or modify CRM contacts / leads. The single
  exception is the explicit "Add to CRM" action (repository.convert_chat).
"""
