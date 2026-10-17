# Anna host

The Host runs inside the core process. It owns:

- the serial task queue;
- the permission gate and approval broker;
- checkpoints for undo;
- long-term memory;
- settings;
- delegation to external agents, and the agents hub (detection, providers, global switching).

It talks to a kernel only through the `AgentKernel` interface in `packages/kernels`. It turns kernel events into stage
state through `Presence`.

The renderer never constructs this module. It uses the contracts in `packages/shared`.
