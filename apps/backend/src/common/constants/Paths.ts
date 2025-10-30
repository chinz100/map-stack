
export default {
  Base: '/api',
  Users: {
    Base: '/users',
    Get: '/all',
    Add: '/add',
    Update: '/update',
    Delete: '/delete/:id',
  },
  Geo: {
    Base: '/geo',
    Cities: '/cities',
  },
} as const;
