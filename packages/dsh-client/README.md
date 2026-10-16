# DSH integration

`Runtime` owns the official SDK subprocess, Anna Profile, plugin receipts, and session restoration.
`EventAdapter` translates official DSH events into stable Anna product events.

Only the Host constructs this package. The renderer imports no DSH implementation or types.
A version change requires real startup, plugin composition, restoration, and shutdown checks.
