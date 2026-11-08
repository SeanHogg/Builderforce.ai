# @builderforce/voice-provenance

Voice-clip provenance primitives: the signed manifest shape (canonical JSON), PCM helpers and an inaudible audio watermark.

## The watermark is a DETECTION mark, not authentication

- The embedding key is public: this package ships to clients, so anyone can embed any id into any audio (forge) and anyone holding the audio can degrade or strip the mark (remove).
- "Watermark present" therefore means only that audio carrying that id was seen. It never proves the platform produced the clip.
- Authenticity comes from the server-signed manifest (HMAC under a server secret) AND a match between the audio's sha256 and `manifest.audioSha256`. A verifier must report a hash match only when the caller supplies the hash and it equals the signed one.
- Clips registered from a user's device (`engine: 'clone-client'`) are self-reported: the server signs what the client claims and never sees the audio.
