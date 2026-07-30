import barrelReexportChain from './barrel-reexport-chain';
import baseClassOverridePropagation from './base-class-override-propagation';
import commentsAreNotUsages from './comments-are-not-usages';
import databaseFieldEndToEnd from './database-field-end-to-end';
import definitionAndUsages from './definition-and-usages';
import deletedApiAndCleanup from './deleted-api-and-cleanup';
import dependencyManifestAndIntegration from './dependency-manifest-and-integration';
import environmentConfigPropagation from './environment-config-propagation';
import exportRenameThroughImports from './export-rename-through-imports';
import graphqlFieldRename from './graphql-field-rename';
import interfaceChangeImplementationsCallers from './interface-change-implementations-callers';
import newErrorFlow from './new-error-flow';
import renamedFileAndImportUpdates from './renamed-file-and-import-updates';
import sameMethodNameDifferentOwners from './same-method-name-different-owners';
import shadowedLocalIsNotExportedUsage from './shadowed-local-is-not-exported-usage';
import snapshotsFollowTheirBehavior from './snapshots-follow-their-behavior';
import tsxPropMigration from './tsx-prop-migration';
import twoIndependentFeaturesCrossSameFiles from './two-independent-features-cross-same-files';
import typeOnlyAndGenericUsages from './type-only-and-generic-usages';
import unchangedEnclosingClass from './unchanged-enclosing-class';

export const reviewGroupingDatasets = [
  definitionAndUsages,
  unchangedEnclosingClass,
  commentsAreNotUsages,
  exportRenameThroughImports,
  sameMethodNameDifferentOwners,
  shadowedLocalIsNotExportedUsage,
  barrelReexportChain,
  interfaceChangeImplementationsCallers,
  baseClassOverridePropagation,
  tsxPropMigration,
  twoIndependentFeaturesCrossSameFiles,
  renamedFileAndImportUpdates,
  deletedApiAndCleanup,
  databaseFieldEndToEnd,
  environmentConfigPropagation,
  newErrorFlow,
  typeOnlyAndGenericUsages,
  snapshotsFollowTheirBehavior,
  graphqlFieldRename,
  dependencyManifestAndIntegration
];
