/**
 * Demo/test corpus. One source of truth for the docs site, the CLI gallery and
 * the screenshot tests — `scripts/write-examples.mjs` also writes them out as
 * plain `.mmd` files so they can be opened in any editor.
 */

export interface Example {
  id: string;
  title: string;
  /** One line on what the example shows off. */
  description: string;
  /** Which styling features this example exercises. */
  highlights?: string[];
  source: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'release-flow',
    title: 'Release pipeline',
    description: 'Subgraphs, decision diamonds, nested shapes and per-class colours.',
    highlights: ['subgraphs', 'classDef', 'curved edges'],
    source: `flowchart LR
  subgraph dev[" Local "]
    code["Write code"] --> test{{"Tests"}}
    test -- "pass" --> lint["Lint"]
    test -- "fail" --> code
  end

  subgraph ci[" CI "]
    lint --> build["Build artifact"]
    build --> sign{"Signed?"}
    sign -- "no" --> build
    sign -- "yes" --> publish
  end

  subgraph prod[" Production "]
    publish["Publish release"] --> canary(["Canary 5%"])
    canary --> full(["Full rollout"])
  end

  classDef danger fill:#ff5555,stroke:#ff5555,color:#1b1b1b;
  classDef ok fill:#50fa7b,stroke:#50fa7b,color:#1b1b1b;
  class sign danger;
  class full ok;`,
  },
  {
    id: 'auth-sequence',
    title: 'OAuth login',
    description: 'Sequence diagram with notes, loops and activations.',
    highlights: ['participants', 'notes', 'loops'],
    source: `sequenceDiagram
  autonumber
  participant U as User
  participant A as App
  participant I as IdP
  participant D as Database

  U->>A: Click "Sign in"
  A->>I: Authorization request + PKCE
  I-->>U: Consent screen
  U->>I: Approve scopes
  I-->>A: Authorization code
  A->>I: Exchange code for tokens
  I-->>A: id_token + refresh_token
  activate A
  A->>D: Upsert user record
  D-->>A: user_id
  deactivate A
  Note over A,D: Session cookie is issued here
  loop Every 15 minutes
    A->>I: Refresh access token
    I-->>A: New access token
  end
  A-->>U: Redirect to dashboard`,
  },
  {
    id: 'order-state',
    title: 'Order lifecycle',
    description: 'State machine with composite states and fork/join.',
    highlights: ['composite states', 'fork/join'],
    source: `stateDiagram-v2
  [*] --> Draft
  Draft --> AwaitingPayment: submit
  AwaitingPayment --> Paid: payment captured
  AwaitingPayment --> Cancelled: timeout (30m)
  state Paid {
    [*] --> Picking
    Picking --> Packed: pick complete
    Packed --> Shipped: courier pickup
  }
  Paid --> Delivered: tracking delivered
  Delivered --> Returned: customer returns
  Delivered --> [*]
  Cancelled --> [*]
  Returned --> Refunded
  Refunded --> [*]`,
  },
  {
    id: 'service-architecture',
    title: 'Service topology',
    description: 'Nested subgraphs standing in for layers of an architecture.',
    highlights: ['nested subgraphs', 'edges to subgraphs'],
    source: `flowchart TB
  client["Client apps"] --> cdn
  client --> gw

  subgraph edge["Edge"]
    direction LR
    cdn["CDN cache"]
    gw["API gateway"]
  end

  subgraph core["Core services"]
    direction LR
    subgraph identity["Identity"]
      auth["Auth"]
      users["User service"]
    end
    subgraph domain["Domain"]
      orders["Orders"]
      billing["Billing"]
    end
  end

  subgraph data["Data"]
    direction LR
    pg[("Postgres")]
    redis[("Redis")]
    queue(["Event bus"])
  end

  cdn --> edge
  edge --> core
  core --> data
  gw --> auth
  auth --> users
  gw --> orders
  orders --> queue
  queue --> billing
  orders --> pg
  auth --> redis
  billing --> pg
  users --> pg`,
  },
  {
    id: 'domain-classes',
    title: 'Domain model',
    description: 'Class diagram with inheritance, composition and interfaces.',
    highlights: ['class diagram', 'generics', 'notes'],
    source: `classDiagram
  direction LR
  class Repository~T~ {
    <<interface>>
    +findById(id) T
    +save(entity) T
    +delete(id) void
  }
  class Entity {
    <<abstract>>
    +UUID id
    +Date createdAt
    +touch() void
  }
  class Order {
    +String reference
    +Money total
    +List~LineItem~ items
    +addItem(item) void
  }
  class LineItem {
    +String sku
    +int quantity
    +Money price
  }
  class Customer {
    +String email
    +String locale
    +Order[] history
  }
  class OrderRepository {
    +findByCustomer(customer) Order[]
  }

  Entity <|-- Order
  Entity <|-- Customer
  Order *-- "1..*" LineItem
  Customer "1" o-- "0..*" Order
  Repository <|.. OrderRepository
  OrderRepository ..> Order : persists`,
  },
  {
    id: 'commerce-er',
    title: 'Commerce schema',
    description: 'ER diagram with relations and attribute types.',
    highlights: ['ER model', 'cardinality', 'keys'],
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    uuid id PK
    string email UK
    string locale
    timestamp created_at
  }
  ORDER ||--|{ ORDER_LINE : contains
  ORDER {
    uuid id PK
    uuid customer_id FK
    string status
    decimal total
  }
  ORDER_LINE {
    uuid id PK
    uuid order_id FK
    string sku
    int quantity
  }
  PRODUCT ||--o{ ORDER_LINE : "is sold as"
  PRODUCT {
    uuid id PK
    string name
    decimal price
    int stock
  }`,
  },
  {
    id: 'launch-gantt',
    title: 'Launch plan',
    description: 'Gantt chart with phases, milestones and dependencies.',
    highlights: ['gantt', 'milestones'],
    source: `gantt
  title Product launch plan
  dateFormat YYYY-MM-DD
  axisFormat %b %d
  todayMarker stroke-width:2px

  section Design
  Research          :done,    r1, 2026-01-05, 10d
  Wireframes        :active,  r2, after r1, 12d
  Visual design     :         r3, after r2, 15d

  section Build
  Core SDK          :crit,    b1, after r2, 25d
  VS Code extension :         b2, after b1, 14d
  CLI + packaging   :         b3, after b1, 10d

  section Ship
  Beta              :milestone, m1, after b2, 0d
  Public launch     :milestone, m2, after b3, 0d`,
  },
  {
    id: 'budget-pie',
    title: 'Budget split',
    description: 'Pie chart — shows how non-graph families inherit the palette.',
    highlights: ['pie', 'legend'],
    source: `pie showData
  title Engineering budget 2026
  "Platform" : 38
  "Product" : 24
  "Infrastructure" : 17
  "Tooling" : 12
  "Research" : 9`,
  },
  {
    id: 'mindmap-roadmap',
    title: 'Roadmap mindmap',
    description: 'Mindmap with branch shapes and icons.',
    highlights: ['mindmap', 'shapes'],
    source: `mindmap
  root((neo<b>mermaid</b>))
    Renderer
      Theme engine
      Palette bridge
      SVG post-process
    Surfaces
      VS Code preview
      CLI export
      Web demo
    Quality
      Visual tests
      Docs
      Examples`,
  },
  {
    id: 'deploy-decision',
    title: 'Deploy decision',
    description: 'Compact decision tree — good for testing edge labels and dashes.',
    highlights: ['dashed edges', 'edge labels'],
    source: `flowchart TD
  start(["Merge to main"]) --> ci{"CI green?"}
  ci -- "no" --> fix["Fix build"]
  fix --> start
  ci -- "yes" --> sec{"Security scan clean?"}
  sec -- "no" --> review["Security review"]
  review --> sec
  sec -- "yes" --> env{"Target env"}
  env -. "staging" .-> staging["Auto deploy"]
  env -. "production" .-> approve["Change approval"]
  approve --> window{"Window open?"}
  window -- "no" --> wait["Wait for window"]
  wait --> window
  window -- "yes" --> rolling["Rolling deploy"]
  staging --> smoke["Smoke tests"]
  rolling --> smoke
  smoke --> ok{"Healthy?"}
  ok -- "no" --> rollback["Rollback"]
  ok -- "yes" --> done(["Release done"])`,
  },
];

export function getExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

/** The shortest example, handy as the default in editors and tests. */
export const DEFAULT_EXAMPLE = EXAMPLES[0]!;
