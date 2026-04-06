export type AggFunc = 'count' | 'min' | 'max' | 'avg' | 'sum';

export type SelectItem =
  | { type: 'field'; field: string }
  | { type: 'aggregation'; aggregation: AggFunc; field?: string };

export interface Condition {
  field: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | '~' | 'contains';
  value: string | number;
}

export type OrderItem =
  | { type: 'field'; field: string; direction: 'asc' | 'desc' }
  | { type: 'aggregation'; aggregation: AggFunc; direction: 'asc' | 'desc' };

export interface QueryAST {
  entity: string;
  select: SelectItem[];
  where: Condition[];
  groupBy: string[];
  orderBy: OrderItem[];
  limit: number | null;
}

export class QueryParseError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly expected: string
  ) {
    super(message);
    this.name = 'QueryParseError';
  }
}

const AGG_FUNCS = new Set<string>(['count', 'min', 'max', 'avg', 'sum']);
const CLAUSE_KEYWORDS = new Set<string>(['where', 'group', 'order', 'limit']);

type TokenType = 'WORD' | 'NUMBER' | 'STRING' | 'OP' | 'COMMA' | 'LPAREN' | 'RPAREN' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }

    if (input[i] === "'") {
      const start = i++;
      let str = '';
      while (i < input.length && input[i] !== "'") str += input[i++];
      if (i >= input.length) {
        throw new QueryParseError(`Unterminated string literal`, start, 'closing single quote');
      }
      i++;
      tokens.push({ type: 'STRING', value: str, position: start });
      continue;
    }

    if (input[i] === '!' && input[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '!=', position: i }); i += 2; continue;
    }
    if (input[i] === '>' && input[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '>=', position: i }); i += 2; continue;
    }
    if (input[i] === '<' && input[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '<=', position: i }); i += 2; continue;
    }
    if (input[i] === '=') { tokens.push({ type: 'OP', value: '=', position: i }); i++; continue; }
    if (input[i] === '>') { tokens.push({ type: 'OP', value: '>', position: i }); i++; continue; }
    if (input[i] === '<') { tokens.push({ type: 'OP', value: '<', position: i }); i++; continue; }
    if (input[i] === '~') { tokens.push({ type: 'OP', value: '~', position: i }); i++; continue; }
    if (input[i] === ',') { tokens.push({ type: 'COMMA', value: ',', position: i }); i++; continue; }
    if (input[i] === '(') { tokens.push({ type: 'LPAREN', value: '(', position: i }); i++; continue; }
    if (input[i] === ')') { tokens.push({ type: 'RPAREN', value: ')', position: i }); i++; continue; }

    if (/[0-9]/.test(input[i]) || (input[i] === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      const start = i;
      let num = input[i] === '-' ? input[i++] : '';
      while (i < input.length && /[0-9.]/.test(input[i])) num += input[i++];
      tokens.push({ type: 'NUMBER', value: num, position: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(input[i])) {
      const start = i;
      let word = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) word += input[i++];
      tokens.push({ type: 'WORD', value: word.toLowerCase(), position: start });
      continue;
    }

    throw new QueryParseError(`Unexpected character: '${input[i]}'`, i, 'valid query token');
  }

  tokens.push({ type: 'EOF', value: '', position: i });
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }

  private at(type: TokenType, value?: string): boolean {
    const tok = this.peek();
    return tok.type === type && (value === undefined || tok.value === value);
  }

  private expect(type: TokenType, value?: string): Token {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      const expected = value ? `'${value}'` : type;
      throw new QueryParseError(
        `Expected ${expected} but got '${tok.value || 'end of input'}'`,
        tok.position,
        expected
      );
    }
    return this.next();
  }

  parse(): QueryAST {
    const entityTok = this.expect('WORD');
    const ast: QueryAST = {
      entity: entityTok.value,
      select: [],
      where: [],
      groupBy: [],
      orderBy: [],
      limit: null,
    };

    // select — parse if next token is not a clause keyword or EOF
    if (!this.at('EOF') && this.at('WORD') && !CLAUSE_KEYWORDS.has(this.peek().value)) {
      ast.select = this.parseSelect();
    }

    if (this.at('WORD', 'where')) {
      this.next();
      ast.where = this.parseWhere();
    }

    if (this.at('WORD', 'group')) {
      this.next();
      this.expect('WORD', 'by');
      ast.groupBy = this.parseGroupBy();
    }

    if (this.at('WORD', 'order')) {
      this.next();
      this.expect('WORD', 'by');
      ast.orderBy = this.parseOrderBy();
    }

    if (this.at('WORD', 'limit')) {
      this.next();
      const tok = this.peek();
      if (tok.type !== 'NUMBER') {
        throw new QueryParseError(`Expected a number after 'limit'`, tok.position, 'number');
      }
      ast.limit = parseInt(this.next().value, 10);
    }

    if (!this.at('EOF')) {
      const tok = this.peek();
      throw new QueryParseError(
        `Unexpected token '${tok.value}'`,
        tok.position,
        'end of query or valid clause keyword (where, group by, order by, limit)'
      );
    }

    return ast;
  }

  private parseSelect(): SelectItem[] {
    const items: SelectItem[] = [];

    while (true) {
      const tok = this.peek();
      if (tok.type !== 'WORD') {
        throw new QueryParseError(
          `Expected field name or aggregation function`,
          tok.position,
          'field name or aggregation function'
        );
      }
      if (CLAUSE_KEYWORDS.has(tok.value)) break;

      const word = tok.value;

      if (AGG_FUNCS.has(word)) {
        this.next(); // consume function name
        if (this.at('LPAREN')) {
          this.next(); // consume '('
          let field: string | undefined;
          if (this.at('WORD') && !CLAUSE_KEYWORDS.has(this.peek().value)) {
            field = this.next().value;
          }
          this.expect('RPAREN');
          items.push({ type: 'aggregation', aggregation: word as AggFunc, field });
        } else {
          // treat as plain field (agg name without parens)
          items.push({ type: 'field', field: word });
        }
      } else {
        items.push({ type: 'field', field: this.next().value });
      }

      if (this.at('COMMA')) {
        this.next();
      } else {
        break;
      }
    }

    return items;
  }

  private parseWhere(): Condition[] {
    const conditions: Condition[] = [];

    while (true) {
      const fieldTok = this.peek();
      if (fieldTok.type !== 'WORD') {
        throw new QueryParseError(`Expected field name in condition`, fieldTok.position, 'field name');
      }
      if (CLAUSE_KEYWORDS.has(fieldTok.value)) {
        throw new QueryParseError(
          `Expected field name but got keyword '${fieldTok.value}'`,
          fieldTok.position,
          'field name'
        );
      }
      const field = this.next().value;

      const opTok = this.peek();
      let operator: Condition['operator'];
      if (opTok.type === 'OP') {
        operator = opTok.value as Condition['operator'];
        this.next();
      } else if (opTok.type === 'WORD' && opTok.value === 'contains') {
        operator = 'contains';
        this.next();
      } else {
        throw new QueryParseError(
          `Expected operator after field '${field}'`,
          opTok.position,
          '=, !=, >, <, >=, <=, ~, or contains'
        );
      }

      const valTok = this.peek();
      let value: string | number;
      if (valTok.type === 'STRING') {
        value = this.next().value;
      } else if (valTok.type === 'NUMBER') {
        value = parseFloat(this.next().value);
      } else {
        throw new QueryParseError(
          `Expected value after operator`,
          valTok.position,
          'string in single quotes or a number'
        );
      }

      conditions.push({ field, operator, value });

      if (this.at('WORD', 'and')) {
        this.next();
      } else {
        break;
      }
    }

    return conditions;
  }

  private parseGroupBy(): string[] {
    const fields: string[] = [];

    while (true) {
      const tok = this.peek();
      if (tok.type !== 'WORD' || CLAUSE_KEYWORDS.has(tok.value)) {
        if (fields.length === 0) {
          throw new QueryParseError(`Expected field name after 'group by'`, tok.position, 'field name');
        }
        break;
      }
      fields.push(this.next().value);
      if (this.at('COMMA')) { this.next(); } else { break; }
    }

    return fields;
  }

  private parseOrderBy(): OrderItem[] {
    const items: OrderItem[] = [];

    while (true) {
      const tok = this.peek();
      if (tok.type !== 'WORD' || CLAUSE_KEYWORDS.has(tok.value)) {
        if (items.length === 0) {
          throw new QueryParseError(
            `Expected field name after 'order by'`,
            tok.position,
            'field name or aggregation function'
          );
        }
        break;
      }

      const word = this.next().value;
      const item: OrderItem = AGG_FUNCS.has(word)
        ? { type: 'aggregation', aggregation: word as AggFunc, direction: 'asc' }
        : { type: 'field', field: word, direction: 'asc' };

      if (this.at('WORD', 'desc')) { this.next(); item.direction = 'desc'; }
      else if (this.at('WORD', 'asc')) { this.next(); item.direction = 'asc'; }

      items.push(item);
      if (this.at('COMMA')) { this.next(); } else { break; }
    }

    return items;
  }
}

export function parseQuery(input: string): QueryAST {
  const tokens = tokenize(input.trim());
  return new Parser(tokens).parse();
}
