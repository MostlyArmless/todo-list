# API Client Migration: Manual → Generated (React Query + Orval)

## Goal

Replace the manually-written API client (`/web/src/lib/api.ts`) with auto-generated React Query hooks from the OpenAPI spec. This ensures:
- Type safety between backend and frontend
- No manual client code to maintain
- Backend changes automatically break frontend until fixed (by design)

## Architecture

```
Backend (FastAPI)
    ↓
OpenAPI spec (http://localhost:8000/openapi.json)
    ↓
orval (npm run generate-api)
    ↓
/web/src/generated/api.ts (React Query hooks + types)
    ↓
Frontend components
```

**Key files:**
- `/web/src/generated/api.ts` - Auto-generated, DO NOT EDIT
- `/web/src/lib/api-fetcher.ts` - Custom fetch wrapper for auth/base URL (used by generated code)
- `/web/src/lib/auth.ts` - Auth helpers (login/logout/getCurrentUser) that handle localStorage
- `/web/src/lib/api.ts` - OLD manual client, DELETE after migration complete

## Completed

### Infrastructure
- [x] Updated orval config for React Query (`/web/orval.config.ts`)
- [x] Installed `@tanstack/react-query`
- [x] Added `QueryClientProvider` in `/web/src/components/Providers.tsx`
- [x] Updated `api-fetcher.ts` to handle orval's request format
- [x] Created `auth.ts` with `login()`, `register()`, `logout()`, `getCurrentUser()`, `isAuthenticated()`, `getToken()`
- [x] Added pre-commit hook to block `@/lib/api` imports (`.pre-commit-config.yaml`)
- [x] Created watcher script (`/scripts/watch-api.sh`) for auto-regeneration
- [x] Updated CLAUDE.md with new API client rules

### Migrated Pages
- [x] `/web/src/app/login/page.tsx` - Uses `login()`, `register()` from auth.ts
- [x] `/web/src/components/Navbar.tsx` - Uses `getCurrentUser()`, `logout()` from auth.ts
- [x] `/web/src/app/lists/page.tsx` - Full React Query migration example
- [x] `/web/src/app/page.tsx` - Uses `getCurrentUser()` from auth.ts
- [x] `/web/src/app/confirm/page.tsx` - Full React Query with polling
- [x] `/web/src/app/settings/page.tsx` - Notification settings with mutations
- [x] `/web/src/app/pantry/page.tsx` - Complex page with receipt scanning
- [x] `/web/src/app/recipes/page.tsx` - Recipe list with sorting
- [x] `/web/src/app/recipes/new/page.tsx` - Recipe creation
- [x] `/web/src/app/recipes/import/page.tsx` - Recipe import with polling
- [x] `/web/src/components/TaskItem.tsx` - Uses types from generated API
- [x] `/web/src/components/PantryCheckModal.tsx` - Uses types from generated API

### Migrated Tests
- [x] `/web/src/app/login/__tests__/page.test.tsx` - Updated to mock `@/lib/auth` instead of `@/lib/api`
- [x] `/web/src/components/__tests__/PantryCheckModal.test.tsx` - Uses types from `@/generated/api`

## Remaining Migration (2 large files)

Files still importing from `@/lib/api`:

1. `/web/src/app/recipes/[id]/page.tsx` - **LARGE** (1,204 lines) - Recipe detail page
2. `/web/src/app/list/[id]/page.tsx` - **LARGEST** (1,433 lines) - List detail page

The pre-commit hook currently excludes these two files. Once migrated, remove the exclusions from `.pre-commit-config.yaml` (the `grep -v` patterns for these files).

## Migration Pattern

### Before (manual api.ts)
```tsx
import { api, type List } from '@/lib/api';

const [lists, setLists] = useState<List[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  api.getLists().then(setLists).finally(() => setLoading(false));
}, []);

const handleCreate = async () => {
  await api.createList({ name });
  // manually reload
  const data = await api.getLists();
  setLists(data);
};
```

### After (generated React Query hooks)
```tsx
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetListsApiV1ListsGet,
  useCreateListApiV1ListsPost,
  getGetListsApiV1ListsGetQueryKey,
  type ListResponse,
} from '@/generated/api';

const queryClient = useQueryClient();

// Queries - automatic caching, loading state
const { data: lists = [], isLoading } = useGetListsApiV1ListsGet();

// Mutations - with cache invalidation
const createMutation = useCreateListApiV1ListsPost({
  mutation: {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetListsApiV1ListsGetQueryKey() });
    },
  },
});

const handleCreate = () => {
  createMutation.mutate({ data: { name } });
};
```

### Auth checks
```tsx
import { getCurrentUser } from '@/lib/auth';

useEffect(() => {
  if (!getCurrentUser()) {
    router.push('/login');
  }
}, [router]);
```

## Finding Generated Hooks

The generated hooks follow this naming pattern:
- GET: `useGet{Resource}ApiV1{Path}Get` (returns useQuery)
- POST: `use{Action}ApiV1{Path}Post` (returns useMutation)
- PUT: `useUpdate{Resource}ApiV1{Path}Put` (returns useMutation)
- DELETE: `useDelete{Resource}ApiV1{Path}Delete` (returns useMutation)

To find available hooks:
```bash
grep "^export const use" web/src/generated/api.ts | head -50
grep "^export function use" web/src/generated/api.ts | head -50
```

Query key getters for cache invalidation:
```bash
grep "QueryKey" web/src/generated/api.ts | head -20
```

## Final Steps

After all files are migrated:
1. Delete `/web/src/lib/api.ts`
2. Run `npx tsc --noEmit` to verify no remaining imports
3. Run pre-commit hook to verify: `bash .git/hooks/pre-commit` or commit
4. Test the app manually

## Commands

```bash
# Regenerate API client after backend changes
cd web && npm run generate-api

# Watch for backend changes (auto-regenerate)
./scripts/watch-api.sh

# Check for remaining manual api imports
grep -r "from '@/lib/api'" web/src --include="*.tsx" --include="*.ts"

# TypeScript check
cd web && npx tsc --noEmit
```

## Lessons Learned & Gotchas

### Type Casting for Optional Response Fields
The generated types sometimes have optional fields that TypeScript complains about. Use nullish coalescing:
```tsx
// Before: TypeScript error - possibly undefined
const count = status.have_count;

// After: Safe with default
const count = status.have_count ?? 0;
```

For responses with unknown shape (like colors endpoint), use type casting:
```tsx
const availableColors = (colorsData as { colors?: string[] } | undefined)?.colors ?? [];
```

### setState in useEffect Warnings
When syncing React Query data to local editable state (e.g., forms), ESLint warns about setState in effects. This is intentional - add eslint-disable comments:
```tsx
/* eslint-disable react-hooks/set-state-in-effect -- Syncing external state to local form */
useEffect(() => {
  if (data) {
    setFormValue(data.value);
  }
}, [data]);
/* eslint-enable react-hooks/set-state-in-effect */
```

### Generic Components for Type Compatibility
`TaskItem.tsx` was made generic to work with both old `Item` type and new `ItemResponse`:
```tsx
interface Item {
  id: number;
  name: string;
  checked: boolean;
  // ... minimal required fields
}

interface TaskItemProps<T extends Item = Item> {
  item: T;
  onComplete: (item: T) => void;
  // ...
}

export default function TaskItem<T extends Item>({ item, ... }: TaskItemProps<T>) {
```

### Polling Pattern
For real-time updates (voice confirmations, receipt scanning, recipe imports):
```tsx
const { data } = useGetSomethingApiV1SomethingGet(id, {
  query: {
    enabled: !!id && shouldPoll,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling when complete
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      return 2000; // Poll every 2 seconds
    },
  },
});
```

### Auth Function Signatures
The new auth functions take objects, not separate parameters:
```tsx
// Old api.ts
api.login(email, password);
api.register(email, password, name);

// New auth.ts
login({ email, password });
register({ email, password, name });
```

## Migrating the Remaining Large Files

### Strategy for recipes/[id]/page.tsx (1,204 lines)
This page has:
- Recipe CRUD operations
- Ingredient management (add/update/delete)
- Image upload
- "Add to shopping list" with pantry check modal
- Step completion tracking

Key hooks to use:
- `useGetRecipeApiV1RecipesRecipeIdGet` - Get recipe details
- `useUpdateRecipeApiV1RecipesRecipeIdPut` - Update recipe
- `useDeleteRecipeApiV1RecipesRecipeIdDelete` - Delete recipe
- `useUploadRecipeImageApiV1RecipesRecipeIdImagePost` - Upload image
- `useCheckRecipePantryApiV1RecipesRecipeIdCheckPantryPost` - Check pantry status
- `useAddRecipeToListApiV1RecipesRecipeIdAddToListPost` - Add to shopping list

### Strategy for list/[id]/page.tsx (1,433 lines)
This is the most complex page with:
- List items CRUD with categories
- Drag-and-drop reordering
- Voice input
- Real-time updates
- Bulk operations (check/uncheck all)

Key hooks to use:
- `useGetListApiV1ListsListIdGet` - Get list with items
- `useUpdateListApiV1ListsListIdPut` - Update list metadata
- `useCreateItemApiV1ListsListIdItemsPost` - Add items
- `useUpdateItemApiV1ItemsItemIdPut` - Update items
- `useDeleteItemApiV1ItemsItemIdDelete` - Delete items
- `useCompleteItemApiV1ItemsItemIdCompletePost` - Complete items (handles recurrence)
- Category hooks for category management

Consider using `useQueryClient()` for optimistic updates on frequent operations like checking items.

## Final Cleanup Checklist

After migrating both files:
1. Remove exclusions from `.pre-commit-config.yaml`:
   - Remove `| grep -v "list/\[id\]/page.tsx"`
   - Remove `| grep -v "recipes/\[id\]/page.tsx"`
2. Delete `/web/src/lib/api.ts`
3. Run full test suite: `cd web && npm test`
4. Run TypeScript check: `cd web && npx tsc --noEmit`
5. Test the app manually on both pages
6. Commit with message noting migration completion
