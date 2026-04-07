import { defineScoutWebPlugin } from "../../../../src/index.js"

export const web = defineScoutWebPlugin({
  screens: [
    {
      id: "fixture-valid.list",
      pluginId: "fixture-valid",
      kind: "entity-list",
      title: "Fixtures",
      entityKind: "thing",
      spec: {
        root: "page",
        elements: {
          page: {
            type: "Page",
            props: {
              title: "Fixtures",
            },
            children: ["fixtures-table"],
          },
          "fixtures-table": {
            type: "EntityTable",
            props: {
              entityKind: "thing",
              columns: [
                {
                  id: "name",
                  label: "Name",
                  source: {
                    type: "field",
                    path: "displayName",
                  },
                },
              ],
            },
          },
        },
      },
    },
  ],
})
