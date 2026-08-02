export interface AssetUpdateV8ProfileSequenceOperations<
  Initial,
  Fresh,
  Produce,
  Pre,
  PreDiagnostic,
  Published,
  Update,
  Post,
  PostDiagnostic,
> {
  readonly freshLaunch: () => Promise<Fresh>;
  readonly initialInstall: () => Promise<Initial>;
  readonly postDiagnosticLaunch: () => Promise<PostDiagnostic>;
  readonly postWarmLaunch: () => Promise<Post>;
  readonly preDiagnosticLaunch: () => Promise<PreDiagnostic>;
  readonly preWarmLaunch: () => Promise<Pre>;
  readonly produceLaunch: () => Promise<Produce>;
  readonly publishAssetUpdate: () => Promise<Published>;
  readonly updateReady: () => Promise<Update>;
}

export interface AssetUpdateV8ProfileSequence<
  Initial,
  Fresh,
  Produce,
  Pre,
  PreDiagnostic,
  Published,
  Update,
  Post,
  PostDiagnostic,
> {
  readonly fresh: Fresh;
  readonly initial: Initial;
  readonly post: Post;
  readonly postDiagnostic: PostDiagnostic;
  readonly pre: Pre;
  readonly preDiagnostic: PreDiagnostic;
  readonly produce: Produce;
  readonly published: Published;
  readonly update: Update;
}

export async function runAssetUpdateV8ProfileSequence<
  Initial,
  Fresh,
  Produce,
  Pre,
  PreDiagnostic,
  Published,
  Update,
  Post,
  PostDiagnostic,
>(
  operations: AssetUpdateV8ProfileSequenceOperations<
    Initial,
    Fresh,
    Produce,
    Pre,
    PreDiagnostic,
    Published,
    Update,
    Post,
    PostDiagnostic
  >,
): Promise<
  AssetUpdateV8ProfileSequence<
    Initial,
    Fresh,
    Produce,
    Pre,
    PreDiagnostic,
    Published,
    Update,
    Post,
    PostDiagnostic
  >
> {
  const initial = await operations.initialInstall();
  const fresh = await operations.freshLaunch();
  const produce = await operations.produceLaunch();
  const preDiagnostic = await operations.preDiagnosticLaunch();
  const pre = await operations.preWarmLaunch();
  const published = await operations.publishAssetUpdate();
  const update = await operations.updateReady();
  const post = await operations.postWarmLaunch();
  const postDiagnostic = await operations.postDiagnosticLaunch();
  return Object.freeze({
    fresh,
    initial,
    post,
    postDiagnostic,
    pre,
    preDiagnostic,
    produce,
    published,
    update,
  });
}
