// A task the account would not take (refused twice by the server): it is
// on this device only until the account signs in again, when it goes once
// more (crates/core/src/replica.rs `release_local_only`). Said on the task.
import type { Data, Task } from '@/lib/tasks'

export const ONLY_HERE = 'Only on this device. Your account did not take it; it goes again when you next sign in.'

export const onlyOnDevice = (task: Task, data: Data): boolean => Boolean(data.localOnly?.includes(task.id))
