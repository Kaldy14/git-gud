import asynchronousExportJobFlow from './asynchronous-export-job-flow';
import barrelReexportChain from './barrel-reexport-chain';
import baseClassOverridePropagation from './base-class-override-propagation';
import commentsAreNotUsages from './comments-are-not-usages';
import databaseFieldEndToEnd from './database-field-end-to-end';
import definitionAndUsages from './definition-and-usages';
import deletedApiAndCleanup from './deleted-api-and-cleanup';
import dependencyManifestAndIntegration from './dependency-manifest-and-integration';
import environmentConfigPropagation from './environment-config-propagation';
import exportRenameThroughImports from './export-rename-through-imports';
import featureFlagRetirement from './feature-flag-retirement';
import graphqlFieldRename from './graphql-field-rename';
import graphqlSearchUnionEvolution from './graphql-search-union-evolution';
import independentProductApiEvolutions from './independent-product-api-evolutions';
import interfaceChangeImplementationsCallers from './interface-change-implementations-callers';
import invoiceEventVersionUpgrade from './invoice-event-version-upgrade';
import newErrorFlow from './new-error-flow';
import orderCancellationTransactionalOutbox from './order-cancellation-transactional-outbox';
import renamedFileAndImportUpdates from './renamed-file-and-import-updates';
import reportExportPermissionContract from './report-export-permission-contract';
import sameMethodNameDifferentOwners from './same-method-name-different-owners';
import shadowedLocalIsNotExportedUsage from './shadowed-local-is-not-exported-usage';
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
  graphqlFieldRename,
  dependencyManifestAndIntegration,
  orderCancellationTransactionalOutbox,
  independentProductApiEvolutions,
  featureFlagRetirement,
  reportExportPermissionContract,
  invoiceEventVersionUpgrade,
  asynchronousExportJobFlow,
  graphqlSearchUnionEvolution
];
