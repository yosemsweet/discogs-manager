There are too many text and markdown documents throughout the repo, and there isn't clarity about what each does. This drives up token usage. Instead I want the following:

1. All architecture decisions are recorded as adrs in adr/*. ADRs should follow Michael Nygards approach to ADRs (https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), template (https://github.com/joelparkerhenderson/architecture-decision-record/tree/main/locales/en/templates/decision-record-template-by-michael-nygard).
1.1. Maintain an index of ADRs with a one line summary of the ADR decision.
1.2. The Claude.md file shall specify reading the index file at the start of every sesssion and will direct to always keep those architectural decisions in mind when making changes. The Claude.md will also specify that whenever a new architectural decision is made it shall be encoded in an ADR.
2. All systems and use cases have documentation in development-docs/.
2.1. Maintain an index of all systems and use cases in development-docs/systems/index.md. The index file should include just enough information to understand the location, use case, and overall structure for each system.
2.2. Further details and documentation for systems be included in development-docs/systems/*. Make a subfolder for each system, and within it have a documentation.md that highlights all the details of the system and how to use it. This file should also cross-reference any ADRs used.
2.3. The Claude.md file shall specify referencing the development-docs/systems/index.md file to find systems and code of interest.
2.3. The Claude.md file shall specify updaing all documentation within development-docs/* as part of completing write. No update to code is complete without also ensuring the system docs are up to date.
3. All other temporary work files should be summarized within adrs/, development-docs/, or feature-requests/. Don't create internal documentation or temporary work files outside those two locations.
3.1. Clean up all existing documentation to match the structure described here.
3.2. feature-requests/ cover new feature requests, when they are complete, move them to feature-requests/complete/ and number them in order. For example: feature_requests/create-playlist-playlist-from-date-added-range.md should become feature-requests/complete/0001-create-playlist-playlist-from-date-added-range.md