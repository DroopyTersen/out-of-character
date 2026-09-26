# Third-party source notices

## AI Elements

The selected source components under `app/ai-elements/` originate from [Vercel AI Elements](https://github.com/vercel/ai-elements), installed through its public shadcn registry on September 18, 2026:

```sh
bunx shadcn@latest add @ai-elements/mic-selector @ai-elements/transcription @ai-elements/speech-input
```

The installed files were moved to `app/ai-elements/`; shadcn utility and primitive imports were adjusted for this repository's `app/shadcn/` paths. Local presentation or capture adaptations remain owned source derived from that registry installation.

Copyright 2023 Vercel, Inc.

The [upstream license](https://github.com/vercel/ai-elements/blob/main/LICENSE) is Apache License 2.0. A complete copy accompanies this repository in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt). This notice does not grant rights to upstream names or trademarks.

Other installed npm dependencies retain their package licenses and notices.
