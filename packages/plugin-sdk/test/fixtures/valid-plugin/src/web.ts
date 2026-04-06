import { defineScoutWebPlugin } from "../../../../src/index.js"

export const web = defineScoutWebPlugin({
  views: [
    {
      id: "fixture-valid.list",
      pluginId: "fixture-valid",
      kind: "list",
      title: "Fixtures",
      entityKind: "thing",
      sections: [
        {
          _tag: "entity-table",
          title: "Fixtures",
          entityKind: "thing",
          columns: [
            {
              id: "name",
              label: "Name",
              source: {
                _tag: "field",
                path: "displayName",
              },
            },
          ],
        },
      ],
    },
  ],
})
