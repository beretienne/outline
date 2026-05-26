import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Table,
  ForeignKey,
  Column,
  PrimaryKey,
  IsUUID,
  BelongsTo,
  DataType,
  Default,
  CreatedAt,
  UpdatedAt,
  Unique,
} from "sequelize-typescript";
import Document from "@server/models/Document";
import Team from "@server/models/Team";
import Model from "@server/models/base/Model";
import Fix from "./decorators/Fix";

/**
 * Generated metadata used to build MCP frontmatter for a document.
 */
@Table({
  tableName: "document_metadata",
  modelName: "document_metadata",
})
@Fix
class DocumentMetadata extends Model<
  InferAttributes<DocumentMetadata>,
  Partial<InferCreationAttributes<DocumentMetadata>>
> {
  @IsUUID(4)
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @Unique
  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @Column(DataType.TEXT)
  summary: string;

  @Default([])
  @Column(DataType.ARRAY(DataType.STRING))
  keywords: string[];

  @Column(DataType.STRING)
  provider: string;

  @Column(DataType.DATE)
  sourceUpdatedAt: Date;

  @Column(DataType.DATE)
  generatedAt: Date;
}

export default DocumentMetadata;
