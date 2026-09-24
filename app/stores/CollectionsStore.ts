import invariant from "invariant";
import { isEmpty, orderBy, sortBy } from "es-toolkit/compat";
import {
  action,
  computed,
  makeObservable,
  observable,
  override,
  runInAction,
} from "mobx";
import type { Filter } from "@shared/helpers/FilterHelper";
import {
  CollectionPermission,
  type FileOperationFormat,
  SubscriptionType,
} from "@shared/types";
import Collection from "~/models/Collection";
import type { PaginationParams, Properties } from "~/types";
import { client } from "~/utils/ApiClient";
import IndexedStore from "./base/IndexedStore";
import type RootStore from "./RootStore";

/** MyST directive and role names used in a collection's documents. */
export interface MystNames {
  directives: string[];
  roles: string[];
}

export default class CollectionsStore extends IndexedStore<Collection> {
  /** MyST names per collection id, as loaded by `fetchMystNames`. */
  @observable
  mystNames = new Map<string, MystNames>();

  constructor(rootStore: RootStore) {
    super(rootStore, Collection);
    makeObservable(this);
  }

  /**
   * Returns the currently active collection, or undefined if not in the context of a collection.
   *
   * @returns The active Collection or undefined
   */
  @computed
  get active(): Collection | undefined {
    return this.rootStore.ui.activeCollectionId
      ? this.data.get(this.rootStore.ui.activeCollectionId)
      : undefined;
  }

  /**
   * Loads the MyST directive and role names used in a collection's
   * documents, once per session, into `mystNames`.
   *
   * @param id - the collection id.
   * @returns the names, or undefined if they could not be loaded.
   */
  @action
  fetchMystNames = async (id: string): Promise<MystNames | undefined> => {
    const cached = this.mystNames.get(id);
    if (cached) {
      return cached;
    }
    try {
      const res = await client.post("/collections.myst_names", { id });
      const names: MystNames = res.data;
      runInAction(() => this.mystNames.set(id, names));
      return names;
    } catch (_err) {
      // Only suggestions depend on this; the built-in lists still work.
      return undefined;
    }
  };

  @computed
  get allActive() {
    return this.orderedData.filter((c) => c.isActive);
  }

  @override
  get orderedData(): Collection[] {
    return super.orderedData.filter((collection) => {
      if (collection.deletedAt) {
        return false;
      }

      const can = this.rootStore.policies.abilities(collection.id);
      return isEmpty(can) || can.readDocument;
    });
  }

  /**
   * Returns all collections that are require explicit permission to access.
   */
  @computed
  get private(): Collection[] {
    return this.all.filter((collection) => collection.isPrivate);
  }

  /**
   * Returns all collections that are accessible by default.
   */
  @computed
  get nonPrivate(): Collection[] {
    return this.all.filter(
      (collection) => collection.isActive && !collection.isPrivate
    );
  }

  /**
   * Returns all collections that are accessible to the current user.
   */
  @computed
  get all(): Collection[] {
    return sortBy(
      Array.from(this.data.values()),
      (collection) => collection.name
    );
  }

  @action
  import = async (
    attachmentId: string,
    options: { format?: string; permission?: CollectionPermission | null }
  ) => {
    await client.post("/collections.import", {
      attachmentId,
      ...options,
    });
  };

  @action
  duplicate = async (
    collection: Collection,
    options?: {
      name?: string;
    }
  ): Promise<Collection> => {
    const res = await client.post("/collections.duplicate", {
      id: collection.id,
      ...options,
    });
    invariant(res?.data, "Data should be available");

    this.addPolicies(res.policies);
    return this.add(res.data);
  };

  @action
  move = async (collectionId: string, index: string) => {
    const res = await client.post("/collections.move", {
      id: collectionId,
      index,
    });
    invariant(res?.success, "Collection could not be moved");
    const collection = this.get(collectionId);

    if (collection) {
      collection.updateIndex(res.data.index);
    }
  };

  @action
  archive = async (collection: Collection) => {
    const res = await client.post("/collections.archive", {
      id: collection.id,
    });
    runInAction(() => {
      invariant(res?.data, "Data should be available");
      this.add(res.data);
      this.addPolicies(res.policies);
    });
  };

  @action
  restore = async (collection: Collection) => {
    const res = await client.post("/collections.restore", {
      id: collection.id,
    });
    runInAction(() => {
      invariant(res?.data, "Data should be available");
      this.add(res.data);
      this.addPolicies(res.policies);
    });
  };

  async update(params: Properties<Collection>): Promise<Collection> {
    const result = await super.update(params);

    // If we're changing sharing permissions on the collection then we need to
    // remove all locally cached policies for documents in the collection as they
    // are now invalid
    if (params.sharing !== undefined) {
      this.rootStore.documents.inCollection(result.id).forEach((document) => {
        this.rootStore.policies.remove(document.id);
      });
    }

    return result;
  }

  fetchNamedPage = async (
    request = "list",
    options: (PaginationParams & { filters?: Filter[] }) | undefined
  ): Promise<Collection[]> =>
    this.fetchPaginated(`/collections.${request}`, options);

  @action
  fetchArchived = async (options?: PaginationParams): Promise<Collection[]> =>
    this.fetchNamedPage("list", {
      ...options,
      filters: [{ field: "archivedAt", operator: "isNotNull" }],
    });

  get(id: string = ""): Collection | undefined {
    return (
      this.data.get(id) ??
      this.orderedData.find((collection) => id.endsWith(collection.urlId))
    );
  }

  @computed
  get archived(): Collection[] {
    return orderBy(this.orderedData, "archivedAt", "desc").filter(
      (c) => c.isArchived && !c.isDeleted
    );
  }

  @computed
  get publicCollections() {
    return this.orderedData.filter(
      (collection) =>
        collection.permission &&
        Object.values(CollectionPermission).includes(collection.permission)
    );
  }

  star = async (collection: Collection, index?: string) => {
    await this.rootStore.stars.create({
      collectionId: collection.id,
      index,
    });
  };

  unstar = async (collection: Collection) => {
    const star = this.rootStore.stars.orderedData.find(
      (s) => s.collectionId === collection.id
    );
    await star?.delete();
  };

  subscribe = (collection: Collection) =>
    this.rootStore.subscriptions.create({
      collectionId: collection.id,
      event: SubscriptionType.Document,
    });

  unsubscribe = (collection: Collection) => {
    const subscription = this.rootStore.subscriptions.getByCollectionId(
      collection.id
    );

    return subscription?.delete();
  };

  @computed
  get navigationNodes() {
    return this.orderedData.map((collection) => collection.asNavigationNode);
  }

  async delete(collection: Collection) {
    await super.delete(collection);
    await this.rootStore.documents.fetchRecentlyUpdated();
    await this.rootStore.documents.fetchRecentlyViewed();
  }

  export = (options: {
    format: FileOperationFormat;
    includeAttachments: boolean;
    includePrivate: boolean;
  }) => client.post("/collections.export_all", options);
}
