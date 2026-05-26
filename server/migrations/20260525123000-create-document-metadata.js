"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("document_metadata", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        allowNull: false,
        primaryKey: true,
      },
      documentId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: "documents",
          key: "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "teams",
          key: "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      keywords: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: false,
        defaultValue: [],
      },
      provider: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      sourceUpdatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      generatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("document_metadata", ["teamId"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("document_metadata");
  },
};
