import { QueryBuilder, CommonQueries, TransactionManager } from '../src/utils/query-builder';
import Database from 'better-sqlite3';
import path from 'path';

describe('QueryBuilder', () => {
  let builder: QueryBuilder;

  beforeEach(() => {
    builder = new QueryBuilder();
  });

  describe('basic SELECT', () => {
    test('builds simple SELECT * query', () => {
      const { sql, params } = builder.select(['*']).from('users').build();

      expect(sql).toBe('SELECT * FROM users');
      expect(params).toEqual([]);
    });

    test('builds SELECT with specific columns', () => {
      const { sql, params } = builder.select(['id', 'name', 'email']).from('users').build();

      expect(sql).toBe('SELECT id, name, email FROM users');
      expect(params).toEqual([]);
    });

    test('throws error if FROM not specified', () => {
      expect(() => builder.select(['*']).build()).toThrow('FROM table must be specified');
    });
  });

  describe('WHERE clauses', () => {
    test('builds query with WHERE condition', () => {
      const { sql, params } = builder
        .select(['*'])
        .from('users')
        .where('id = ?', [1])
        .build();

      expect(sql).toBe('SELECT * FROM users WHERE id = ?');
      expect(params).toEqual([1]);
    });

    test('builds query with multiple AND WHERE', () => {
      const { sql, params } = builder
        .select(['*'])
        .from('users')
        .where('id = ?', [1])
        .andWhere('status = ?', ['active'])
        .build();

      expect(sql).toBe('SELECT * FROM users WHERE id = ? AND status = ?');
      expect(params).toEqual([1, 'active']);
    });

    test('builds query with OR WHERE', () => {
      const { sql, params } = builder
        .select(['*'])
        .from('users')
        .where('status = ?', ['active'])
        .orWhere('status = ?', ['pending'])
        .build();

      expect(sql).toContain('OR');
      expect(params).toEqual(['active', 'pending']);
    });

    test('WHERE without params', () => {
      const { sql, params } = builder
        .select(['*'])
        .from('users')
        .where('deleted_at IS NULL')
        .build();

      expect(sql).toBe('SELECT * FROM users WHERE deleted_at IS NULL');
      expect(params).toEqual([]);
    });
  });

  describe('ORDER BY', () => {
    test('builds with single ORDER BY ASC', () => {
      const { sql } = builder
        .select(['*'])
        .from('users')
        .orderBy('name', 'ASC')
        .build();

      expect(sql).toBe('SELECT * FROM users ORDER BY name ASC');
    });

    test('builds with ORDER BY DESC', () => {
      const { sql } = builder
        .select(['*'])
        .from('users')
        .orderBy('created_at', 'DESC')
        .build();

      expect(sql).toBe('SELECT * FROM users ORDER BY created_at DESC');
    });

    test('builds with multiple ORDER BY', () => {
      const { sql } = builder
        .select(['*'])
        .from('users')
        .orderBy('status', 'ASC')
        .orderBy('created_at', 'DESC')
        .build();

      expect(sql).toBe('SELECT * FROM users ORDER BY status ASC, created_at DESC');
    });

    test('defaults ORDER BY direction to ASC', () => {
      const { sql } = builder.select(['*']).from('users').orderBy('name').build();

      expect(sql).toBe('SELECT * FROM users ORDER BY name ASC');
    });
  });

  describe('LIMIT and OFFSET', () => {
    test('builds with LIMIT only', () => {
      const { sql } = builder.select(['*']).from('users').limit(10).build();

      expect(sql).toBe('SELECT * FROM users LIMIT 10');
    });

    test('builds with OFFSET only', () => {
      const { sql } = builder.select(['*']).from('users').offset(20).build();

      expect(sql).toBe('SELECT * FROM users OFFSET 20');
    });

    test('builds with LIMIT and OFFSET', () => {
      const { sql } = builder.select(['*']).from('users').limit(10).offset(20).build();

      expect(sql).toBe('SELECT * FROM users LIMIT 10 OFFSET 20');
    });
  });

  describe('complex queries', () => {
    test('builds complex multi-condition query', () => {
      const { sql, params } = builder
        .select(['id', 'name', 'email'])
        .from('users')
        .where('status = ?', ['active'])
        .andWhere('role = ?', ['admin'])
        .andWhere('created_at > ?', ['2023-01-01'])
        .orderBy('created_at', 'DESC')
        .limit(50)
        .build();

      expect(sql).toContain('SELECT id, name, email FROM users');
      expect(sql).toContain('WHERE');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT 50');
      expect(params).toEqual(['active', 'admin', '2023-01-01']);
    });

    test('pagination query', () => {
      const { sql, params } = builder
        .select(['*'])
        .from('products')
        .where('category = ?', ['electronics'])
        .orderBy('price', 'ASC')
        .limit(20)
        .offset(40)
        .build();

      expect(sql).toContain('LIMIT 20 OFFSET 40');
      expect(params).toEqual(['electronics']);
    });
  });

  describe('reset', () => {
    test('resets builder to initial state', () => {
      builder.select(['id', 'name']).from('users').where('id = ?', [1]).limit(10);

      builder.reset();

      expect(() => builder.build()).toThrow('FROM table must be specified');
    });

    test('allows reuse after reset', () => {
      builder.select(['*']).from('users').limit(10);
      builder.reset();

      const { sql } = builder.select(['id']).from('products').build();

      expect(sql).toBe('SELECT id FROM products');
    });
  });
});

describe('CommonQueries', () => {
  test('selectAll', () => {
    const { sql, params } = CommonQueries.selectAll('users');

    expect(sql).toBe('SELECT * FROM users');
    expect(params).toEqual([]);
  });

  test('selectWhere', () => {
    const { sql, params } = CommonQueries.selectWhere('users', 'id', 5);

    expect(sql).toBe('SELECT * FROM users WHERE id = ?');
    expect(params).toEqual([5]);
  });

  test('selectLimit', () => {
    const { sql, params } = CommonQueries.selectLimit('users', 10, 'created_at', 'DESC');

    expect(sql).toContain('LIMIT 10');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(params).toEqual([]);
  });

  test('count', () => {
    const { sql, params } = CommonQueries.count('users');

    expect(sql).toBe('SELECT COUNT(*) as count FROM users');
    expect(params).toEqual([]);
  });

  test('countWhere', () => {
    const { sql, params } = CommonQueries.countWhere('users', 'status', 'active');

    expect(sql).toBe('SELECT COUNT(*) as count FROM users WHERE status = ?');
    expect(params).toEqual(['active']);
  });

  test('paginate', () => {
    const { sql, params } = CommonQueries.paginate('users', 2, 25, 'name', 'ASC');

    expect(sql).toContain('LIMIT 25 OFFSET 25');
    expect(sql).toContain('ORDER BY name ASC');
    expect(params).toEqual([]);
  });

  test('search', () => {
    const { sql, params } = CommonQueries.search('users', 'name', 'john', 50);

    expect(sql).toContain('LIKE ?');
    expect(sql).toContain('LIMIT 50');
    expect(params).toEqual(['%john%']);
  });

  test('paginate first page', () => {
    const { sql } = CommonQueries.paginate('users', 1, 10);

    expect(sql).toContain('OFFSET 0');
  });

  test('paginate last page offset calculation', () => {
    const { sql } = CommonQueries.paginate('users', 5, 20);

    expect(sql).toContain('OFFSET 80');
  });
});

describe('TransactionManager', () => {
  let db: Database.Database;
  let manager: TransactionManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        balance INTEGER DEFAULT 0
      );
      INSERT INTO users (name, balance) VALUES ('Alice', 100);
      INSERT INTO users (name, balance) VALUES ('Bob', 50);
    `);
    manager = new TransactionManager(db);
  });

  afterEach(() => {
    db.close();
  });

  test('executes transaction successfully', () => {
    const result = manager.transaction(() => {
      db.prepare('UPDATE users SET balance = balance - 10 WHERE name = ?').run('Alice');
      db.prepare('UPDATE users SET balance = balance + 10 WHERE name = ?').run('Bob');
      return 'success';
    });

    expect(result).toBe('success');

    const alice = db.prepare('SELECT balance FROM users WHERE name = ?').get('Alice') as any;
    const bob = db.prepare('SELECT balance FROM users WHERE name = ?').get('Bob') as any;

    expect(alice.balance).toBe(90);
    expect(bob.balance).toBe(60);
  });

  test('rolls back on error', () => {
    const initialAlice = db.prepare('SELECT balance FROM users WHERE name = ?').get('Alice') as any;

    try {
      manager.transaction(() => {
        db.prepare('UPDATE users SET balance = balance - 50 WHERE name = ?').run('Alice');
        throw new Error('Simulated error');
      });
    } catch (e) {
      // Expected error
    }

    const currentAlice = db.prepare('SELECT balance FROM users WHERE name = ?').get('Alice') as any;

    expect(currentAlice.balance).toBe(initialAlice.balance);
  });

  test('batch executes multiple statements', () => {
    manager.batch([
      { sql: 'UPDATE users SET balance = 200 WHERE name = ?', params: ['Alice'] },
      { sql: 'UPDATE users SET balance = 150 WHERE name = ?', params: ['Bob'] },
    ]);

    const alice = db.prepare('SELECT balance FROM users WHERE name = ?').get('Alice') as any;
    const bob = db.prepare('SELECT balance FROM users WHERE name = ?').get('Bob') as any;

    expect(alice.balance).toBe(200);
    expect(bob.balance).toBe(150);
  });

  test('batch rolls back all on single error', () => {
    const initialAlice = db.prepare('SELECT balance FROM users WHERE name = ?').get('Alice') as any;
    const initialBob = db.prepare('SELECT balance FROM users WHERE name = ?').get('Bob') as any;

    try {
      manager.batch([
        { sql: 'UPDATE users SET balance = 200 WHERE name = ?', params: ['Alice'] },
        { sql: 'INVALID SQL', params: [] }, // This will cause error
      ]);
    } catch (e) {
      // Expected error
    }

    const currentAlice = db.prepare('SELECT balance FROM users WHERE name = ?').get('Alice') as any;
    const currentBob = db.prepare('SELECT balance FROM users WHERE name = ?').get('Bob') as any;

    // Both should be unchanged due to rollback
    expect(currentAlice.balance).toBe(initialAlice.balance);
    expect(currentBob.balance).toBe(initialBob.balance);
  });
});

describe('QueryBuilder with database', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        price REAL,
        stock INTEGER
      );
      INSERT INTO products (name, category, price, stock) VALUES ('Laptop', 'electronics', 999.99, 5);
      INSERT INTO products (name, category, price, stock) VALUES ('Mouse', 'electronics', 29.99, 50);
      INSERT INTO products (name, category, price, stock) VALUES ('Desk', 'furniture', 299.99, 10);
      INSERT INTO products (name, category, price, stock) VALUES ('Chair', 'furniture', 199.99, 15);
    `);
  });

  afterEach(() => {
    db.close();
  });

  test('query with QueryBuilder results', () => {
    const query = new QueryBuilder()
      .select(['name', 'price'])
      .from('products')
      .where('category = ?', ['electronics'])
      .orderBy('price', 'DESC')
      .build();

    const stmt = db.prepare(query.sql);
    const results = stmt.all(...query.params) as any[];

    expect(results.length).toBe(2);
    expect(results[0].name).toBe('Laptop');
    expect(results[1].name).toBe('Mouse');
  });

  test('pagination with real data', () => {
    const query = CommonQueries.paginate('products', 1, 2, 'price', 'ASC');
    const stmt = db.prepare(query.sql);
    const results = stmt.all(...query.params) as any[];

    expect(results.length).toBe(2);
    expect(results[0].name).toBe('Mouse');
    expect(results[1].name).toBe('Chair');
  });

  test('search with real data', () => {
    const query = CommonQueries.search('products', 'name', 'Chair', 10);
    const stmt = db.prepare(query.sql);
    const results = stmt.all(...query.params) as any[];

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Chair');
  });

  test('count with real data', () => {
    const query = CommonQueries.countWhere('products', 'category', 'electronics');
    const stmt = db.prepare(query.sql);
    const result = stmt.get(...query.params) as any;

    expect(result.count).toBe(2);
  });
});
