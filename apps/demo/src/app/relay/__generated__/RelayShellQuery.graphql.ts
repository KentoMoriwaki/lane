/**
 * @generated SignedSource<<c1f03578f6d70066472d0693d5771985>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type RelayShellQuery$variables = Record<PropertyKey, never>;
export type RelayShellQuery$data = {
  readonly viewer: {
    readonly color: string;
    readonly defaultTeamId: string;
    readonly email: string;
    readonly id: string;
    readonly initials: string;
    readonly name: string;
    readonly userId: string;
    readonly " $fragmentSpreads": FragmentRefs<"sidebarUser_viewer">;
  };
  readonly " $fragmentSpreads": FragmentRefs<"filterBar_query" | "insightStrip_insights" | "sidebarNav_query" | "teamSwitcher_query">;
};
export type RelayShellQuery = {
  response: RelayShellQuery$data;
  variables: RelayShellQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "userId",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "email",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "initials",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "color",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "defaultTeamId",
  "storageKey": null
},
v7 = [
  (v0/*:: as any*/),
  (v2/*:: as any*/),
  (v5/*:: as any*/)
],
v8 = {
  "alias": null,
  "args": null,
  "concreteType": "Label",
  "kind": "LinkedField",
  "name": "labels",
  "plural": true,
  "selections": (v7/*:: as any*/),
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "assignedToMe",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "unassigned",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "overdue",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "dueSoon",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "completed",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "RelayShellQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "Viewer",
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          (v1/*:: as any*/),
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "sidebarUser_viewer"
          }
        ],
        "storageKey": null
      },
      {
        "args": null,
        "kind": "FragmentSpread",
        "name": "teamSwitcher_query"
      },
      {
        "kind": "Defer",
        "selections": [
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "sidebarNav_query"
          }
        ]
      },
      {
        "kind": "Defer",
        "selections": [
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "filterBar_query"
          }
        ]
      },
      {
        "kind": "Defer",
        "selections": [
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "insightStrip_insights"
          }
        ]
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "RelayShellQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "Viewer",
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          (v1/*:: as any*/),
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "TeamSummary",
        "kind": "LinkedField",
        "name": "teams",
        "plural": true,
        "selections": [
          (v0/*:: as any*/),
          (v2/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "slug",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "role",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "memberCount",
            "storageKey": null
          }
        ],
        "storageKey": null
      },
      {
        "if": null,
        "kind": "Defer",
        "label": "RelayShellQuery$defer$sidebarNav_query",
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "Project",
            "kind": "LinkedField",
            "name": "projects",
            "plural": true,
            "selections": [
              (v0/*:: as any*/),
              (v2/*:: as any*/),
              (v5/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "taskCount",
                "storageKey": null
              }
            ],
            "storageKey": null
          },
          (v8/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "Insights",
            "kind": "LinkedField",
            "name": "insights",
            "plural": false,
            "selections": [
              (v9/*:: as any*/),
              (v10/*:: as any*/),
              (v11/*:: as any*/),
              (v12/*:: as any*/),
              (v13/*:: as any*/)
            ],
            "storageKey": null
          }
        ]
      },
      {
        "if": null,
        "kind": "Defer",
        "label": "RelayShellQuery$defer$filterBar_query",
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "Project",
            "kind": "LinkedField",
            "name": "projects",
            "plural": true,
            "selections": (v7/*:: as any*/),
            "storageKey": null
          },
          (v8/*:: as any*/)
        ]
      },
      {
        "if": null,
        "kind": "Defer",
        "label": "RelayShellQuery$defer$insightStrip_insights",
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "Insights",
            "kind": "LinkedField",
            "name": "insights",
            "plural": false,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "open",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "inProgress",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "inReview",
                "storageKey": null
              },
              (v13/*:: as any*/),
              (v11/*:: as any*/),
              (v10/*:: as any*/),
              (v9/*:: as any*/),
              (v12/*:: as any*/)
            ],
            "storageKey": null
          }
        ]
      }
    ]
  },
  "params": {
    "cacheID": "9f01aed42f2ac683d6e96f6eece1ce16",
    "id": null,
    "metadata": {},
    "name": "RelayShellQuery",
    "operationKind": "query",
    "text": "query RelayShellQuery {\n  viewer {\n    id\n    userId\n    name\n    email\n    initials\n    color\n    defaultTeamId\n    ...sidebarUser_viewer\n  }\n  ...teamSwitcher_query\n  ...sidebarNav_query @defer(label: \"RelayShellQuery$defer$sidebarNav_query\")\n  ...filterBar_query @defer(label: \"RelayShellQuery$defer$filterBar_query\")\n  ...insightStrip_insights @defer(label: \"RelayShellQuery$defer$insightStrip_insights\")\n}\n\nfragment filterBar_query on Query {\n  projects {\n    id\n    name\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n\nfragment insightStrip_insights on Query {\n  insights {\n    open\n    inProgress\n    inReview\n    completed\n    overdue\n    unassigned\n    assignedToMe\n    dueSoon\n  }\n}\n\nfragment sidebarNav_query on Query {\n  projects {\n    id\n    name\n    color\n    taskCount\n  }\n  labels {\n    id\n    name\n    color\n  }\n  insights {\n    assignedToMe\n    unassigned\n    overdue\n    dueSoon\n    completed\n  }\n}\n\nfragment sidebarUser_viewer on Viewer {\n  name\n  email\n  initials\n  color\n}\n\nfragment teamSwitcher_query on Query {\n  teams {\n    id\n    name\n    slug\n    role\n    memberCount\n  }\n}\n"
  }
};
})();

(node as any).hash = "6bc9c89cc54ab1a4331493cb7d9e20a8";

export default node;
