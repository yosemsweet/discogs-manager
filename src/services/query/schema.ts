import { QueryAST, SelectItem, Condition, AggFunc } from './parser';

export type FieldType = 'text' | 'number' | 'date' | 'multi_text';

export interface FieldDefinition {
  name: string;
  type: FieldType;
  column: string;
  description: string;
}

export interface EntityDefinition {
  name: string;
  fromClause: string;
  fields: FieldDefinition[];
  defaultSelect: string[];
  defaultOrderBy: Array<{ field?: string; aggregation?: AggFunc; direction: 'asc' | 'desc' }>;
  isVirtual?: boolean;
}

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly entity: string,
    public readonly field: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

const NUMERIC_OPERATORS = new Set(['>', '<', '>=', '<=']);
const AGG_NUMERIC_ONLY = new Set<AggFunc>(['avg', 'sum']);

const ENTITIES: Record<string, EntityDefinition> = {
  releases: {
    name: 'releases',
    fromClause: 'releases r',
    fields: [
      { name: 'title',  type: 'text',       column: 'r.title',    description: 'Release title' },
      { name: 'artist', type: 'text',        column: 'r.artists',  description: 'Artist(s) of the release' },
      { name: 'year',   type: 'number',      column: 'r.year',     description: 'Release year' },
      { name: 'genre',  type: 'multi_text',  column: 'r.genres',   description: 'Genres (comma-separated)' },
      { name: 'style',  type: 'multi_text',  column: 'r.styles',   description: 'Styles (comma-separated)' },
      { name: 'label',  type: 'multi_text',  column: 'r.labels',   description: 'Labels (comma-separated)' },
      { name: 'rating', type: 'number',      column: 'r.rating',   description: 'User rating (0-5)' },
      { name: 'added',  type: 'date',        column: 'date(r.addedAt)', description: 'Date added to collection' },
    ],
    defaultSelect: ['title', 'artist', 'year', 'genre', 'style', 'rating', 'added'],
    defaultOrderBy: [{ field: 'added', direction: 'desc' }],
  },

  tracks: {
    name: 'tracks',
    fromClause: 'tracks t JOIN releases r ON t.releaseId = r.discogsId',
    fields: [
      { name: 'title',    type: 'text',      column: 't.title',                        description: 'Track title' },
      { name: 'artist',   type: 'text',      column: 'COALESCE(NULLIF(t.artists, \'\'), r.artists)', description: 'Track artist(s)' },
      { name: 'position', type: 'text',      column: 't.position',                     description: 'Track position (e.g. A1)' },
      { name: 'duration', type: 'text',      column: 't.duration',                     description: 'Track duration' },
      { name: 'release',  type: 'text',      column: 'r.title',                        description: 'Parent release title' },
      { name: 'year',     type: 'number',    column: 'r.year',                         description: 'Release year' },
      { name: 'genre',    type: 'multi_text',column: 'r.genres',                       description: 'Release genres' },
      { name: 'style',    type: 'multi_text',column: 'r.styles',                       description: 'Release styles' },
      { name: 'label',    type: 'multi_text',column: 'r.labels',                       description: 'Release labels' },
      { name: 'added',    type: 'date',      column: 'date(r.addedAt)',                description: 'Date release was added' },
    ],
    defaultSelect: ['title', 'artist', 'release', 'year', 'genre', 'style'],
    defaultOrderBy: [{ field: 'release', direction: 'asc' }, { field: 'position', direction: 'asc' }],
  },

  artists: {
    name: 'artists',
    fromClause: '',
    isVirtual: true,
    fields: [
      { name: 'name',     type: 'text',       column: 'name',     description: 'Artist name' },
      { name: 'releases', type: 'number',     column: 'releases', description: 'Number of releases' },
      { name: 'genres',   type: 'multi_text', column: 'genres',   description: 'All genres across releases' },
      { name: 'styles',   type: 'multi_text', column: 'styles',   description: 'All styles across releases' },
    ],
    defaultSelect: ['name', 'releases', 'genres', 'styles'],
    defaultOrderBy: [{ field: 'releases', direction: 'desc' }],
  },
};

export function getEntityDefinition(name: string): EntityDefinition {
  const entity = ENTITIES[name];
  if (!entity) {
    const available = getAvailableEntities().join(', ');
    throw new SchemaValidationError(
      `Unknown entity '${name}'. Available entities: ${available}`,
      name,
      '',
      `unknown entity`
    );
  }
  return entity;
}

export function getAvailableEntities(): string[] {
  return Object.keys(ENTITIES);
}

export function getFieldsForEntity(entityName: string): FieldDefinition[] {
  return getEntityDefinition(entityName).fields;
}

export function getField(entityName: string, fieldName: string): FieldDefinition {
  const entity = getEntityDefinition(entityName);
  const field = entity.fields.find(f => f.name === fieldName);
  if (!field) {
    const available = entity.fields.map(f => f.name).join(', ');
    throw new SchemaValidationError(
      `Unknown field '${fieldName}' on ${entityName}. Available fields: ${available}`,
      entityName,
      fieldName,
      'unknown field'
    );
  }
  return field;
}

export function validateAST(ast: QueryAST): void {
  // Validate entity
  const entity = getEntityDefinition(ast.entity);

  // Collect all referenced field names for validation
  const allFields = (items: SelectItem[]): string[] =>
    items.filter(i => i.type === 'field' && i.field).map(i => i.field!);

  // Validate select fields
  for (const item of ast.select) {
    if (item.type === 'field' && item.field) {
      getField(ast.entity, item.field);
    }
    if (item.type === 'aggregation' && item.field) {
      const f = getField(ast.entity, item.field);
      if (item.aggregation && AGG_NUMERIC_ONLY.has(item.aggregation) && f.type !== 'number') {
        throw new SchemaValidationError(
          `'${item.aggregation}' requires a numeric field, but '${item.field}' is type '${f.type}'`,
          ast.entity,
          item.field,
          'non-numeric field used with avg/sum'
        );
      }
    }
  }

  // Validate where conditions
  for (const cond of ast.where) {
    const field = getField(ast.entity, cond.field);
    if (cond.operator === 'contains' && field.type !== 'multi_text') {
      throw new SchemaValidationError(
        `Operator 'contains' can only be used with multi-value fields (genre, style, label, genres, styles). Field '${cond.field}' is type '${field.type}'`,
        ast.entity,
        cond.field,
        'contains on non-multi_text field'
      );
    }
    if (NUMERIC_OPERATORS.has(cond.operator) && field.type === 'text') {
      throw new SchemaValidationError(
        `Operator '${cond.operator}' cannot be used with text field '${cond.field}'`,
        ast.entity,
        cond.field,
        'numeric operator on text field'
      );
    }
  }

  // Validate group by fields
  for (const f of ast.groupBy) {
    getField(ast.entity, f);
  }

  // Validate order by fields
  for (const item of ast.orderBy) {
    if (item.field) getField(ast.entity, item.field);
  }

  // Aggregation consistency: if any select item is an aggregation,
  // all non-aggregated select fields must appear in group by
  const hasAggregation = ast.select.some(i => i.type === 'aggregation');
  if (hasAggregation && ast.groupBy.length > 0) {
    const nonAggFields = allFields(ast.select);
    const groupBySet = new Set(ast.groupBy);
    for (const f of nonAggFields) {
      if (!groupBySet.has(f)) {
        throw new SchemaValidationError(
          `Field '${f}' appears in select but not in group by. Add '${f}' to the group by clause.`,
          ast.entity,
          f,
          'non-aggregated field missing from group by'
        );
      }
    }
  }

  // Suppress unused variable warning
  void entity;
}
